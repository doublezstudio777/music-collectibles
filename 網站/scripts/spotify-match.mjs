// 藝人 → Spotify 藝人 ID 對應（2026-09-30，Spotify 自動抽歌）。本機跑，不是 Worker。
//
// 用法（在 網站/ 底下；Spotify 金鑰由環境變數給，不寫進任何檔案）：
//   set -a; . <(tr -d "\r" < …/_私人/spotify.txt); . <(tr -d "\r" < …/_私人/cloudflare.txt); set +a
//   node scripts/spotify-match.mjs --remote|--local [--persist-to <資料夾>]            只比對，寫 scripts/spotify-artists.json 與報告
//   node scripts/spotify-match.mjs --remote|--local --apply [--persist-to …]            比對完寫進 D1 的 spotify_artists
//   node scripts/spotify-match.mjs --remote|--local --apply-only [--persist-to …]       不重新比對，把 spotify-artists.json 寫進 D1
//
// 對應規則（照順序，前面成立就不看後面；不確定的一律留空列進報告，不硬配）：
//   1. MusicBrainz：藝人有 mbid，且 MusicBrainz 藝人頁有 open.spotify.com/artist 連結（只有一個）→ 用那個
//   2. 手動歌單：spotify_picks 裡這位藝人的歌，Get Track 看第一位演出者；所有歌都指到同一個 ID、且 Spotify 名稱＝站上名稱或別名 → 用那個
//   3. 搜尋：用中文名與別名搜（limit 10，2026-02 起上限），名稱或別名完全相同的候選恰好一位，
//      而且候選的專輯／單曲標題跟已知作品（站上系列標題、金曲金音入圍作品、維基簡介《》、手動歌單歌名）有交集 → 用那個
//      同名候選兩位以上、或沒有作品交集、或站上沒有已知作品可比 → 列「疑義」不配
//   手動指定：scripts/spotify-manual.json { 識別碼: { spotifyId, evidence } }，優先於以上規則
//   使用者確認不配：spotify-manual.json 的 rejected（all＝整位不配；ids＝這幾個 ID 不是本人）
//   node scripts/spotify-match.mjs --remote|--local --sync-decisions    把 rejected 與 whenVisible（藝人頁還沒顯示、出現時才用的 ID）
//     同步進 D1 的 spotify_match，給 Worker 自動比對（lib/server/spotify-auto.ts）用；--print-decisions 只印 SQL
//
// Spotify API 回應快取在 .cache/spotify/（已在 .gitignore 的 .cache/ 底下），重跑直接讀快取；429 依 Retry-After 等待。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mb, norm, titleHit } from "./musicbrainz-fetch.mjs";

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("要指定 --remote（正式）或 --local（本機）");
  process.exit(2);
}
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const apply = argv.includes("--apply") || argv.includes("--apply-only");
const applyOnly = argv.includes("--apply-only");
const persist = opt("--persist-to", ".wrangler/state");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "scripts", "spotify-artists.json");
const REPORT = join(root, "..", "產出", "20260930_Spotify自動抽歌", "藝人對應報告.json");
const CACHE = join(root, ".cache", "spotify");

const wrangler = (args, capture = false) =>
  spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], {
    cwd: root,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const target = remote ? ["--remote", "--config", "wrangler.production.jsonc"] : ["--local", "--config", "wrangler.local.jsonc", "--persist-to", persist];
const query = (sql) => {
  const r = wrangler(["d1", "execute", "DB", ...target, "--json", "--command", sql], true);
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`查詢失敗：${sql.slice(0, 200)}`);
  }
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0].results;
};
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

/* ---------- Spotify ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = "";
let tokenExp = 0;
let last = 0;
const sstats = { network: 0, cached: 0, r429: 0 };
async function getToken() {
  if (token && Date.now() < tokenExp - 60_000) return token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("缺環境變數 SPOTIFY_CLIENT_ID／SPOTIFY_CLIENT_SECRET");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`Spotify 換 token 失敗 ${r.status}`);
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + j.expires_in * 1000;
  return token;
}
class QuotaError extends Error {}
/** GET Spotify（有快取就讀快取）；404 回 null */
async function sp(path) {
  const url = `https://api.spotify.com/v1/${path}`;
  const file = join(CACHE, `${createHash("sha1").update(url).digest("hex")}.json`);
  if (existsSync(file)) {
    sstats.cached++;
    return JSON.parse(readFileSync(file, "utf8")).body;
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    sstats.network++;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(30000) });
    if (r.status === 429) {
      sstats.r429++;
      const s = Math.max(1, Number(r.headers.get("retry-after")) || 2 ** (attempt + 1));
      // 2026-10-03 起任何 429 都立刻停（development mode 配額一鎖就是 24 小時，短的也不等），丟出去讓主程式存檔收工，下次重跑從快取接著做
      throw new QuotaError(`Spotify 429（${path.split("?")[0].replace(/[A-Za-z0-9]{22}/g, "ID")}），Retry-After ${s} 秒（約 ${Math.round(s / 3600)} 小時）`);
    }
    if (r.status === 401) {
      token = "";
      continue;
    }
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) {
      await sleep(2 ** (attempt + 1) * 1000);
      continue;
    }
    const body = await r.json();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
    return body;
  }
  throw new Error(`Spotify 重試 6 次仍失敗：${url}`);
}
/** 快取裡已有的 Get Artist's Albums 分頁（不連網；這個配額桶很小，比對時不再打） */
function cachedAlbumTitles(id) {
  const out = [];
  for (let offset = 0; offset < 500; offset += 10) {
    const url = `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album,single&market=TW&limit=10&offset=${offset}`;
    const file = join(CACHE, `${createHash("sha1").update(url).digest("hex")}.json`);
    if (!existsSync(file)) break;
    const b = JSON.parse(readFileSync(file, "utf8")).body;
    if (!b) break;
    out.push(...b.items.map((a) => a.name));
    if (!b.next) break;
  }
  return out;
}
/** 搜尋專輯（每個名字一次、limit 10）：回傳 Spotify 藝人 ID → 他名下的專輯標題 */
async function searchAlbums(names) {
  const by = new Map();
  for (const nm of names) {
    const b = await sp(`search?q=${encodeURIComponent(`artist:${nm}`)}&type=album&limit=10&market=TW`);
    for (const al of b?.albums?.items ?? []) for (const a of al.artists ?? []) by.set(a.id, [...(by.get(a.id) ?? []), al.name]);
  }
  return by;
}

/* ---------- 讀站上資料 ---------- */
const manualFile = join(root, "scripts", "spotify-manual.json");
const manualAll = existsSync(manualFile) ? JSON.parse(readFileSync(manualFile, "utf8")) : {};
const manual = manualAll.artists ?? {};
// 2026-10-03：使用者確認不配的（all＝整位不配，ids＝這幾個 Spotify ID 不是本人）。Worker 自動比對讀 D1 的 spotify_match，由 --sync-decisions 同步
const rejected = manualAll.rejected ?? {};

async function match() {
  const people = query(
    `SELECT slug, name, aliases, mbid, intro FROM artists WHERE kind='藝人' AND status='approved' AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY slug`,
  );
  const seriesTitles = new Map();
  for (const s of query(`SELECT artist_slug AS a, title FROM series WHERE deleted_at IS NULL AND status='approved'`)) {
    if (!seriesTitles.has(s.a)) seriesTitles.set(s.a, []);
    seriesTitles.get(s.a).push(s.title);
  }
  const picks = new Map();
  for (const p of query(`SELECT artist_slug AS a, track_id AS t, title FROM spotify_picks`)) {
    if (!picks.has(p.a)) picks.set(p.a, []);
    picks.get(p.a).push(p);
  }
  const nomFile = join(root, "..", "研究", "20260927_金曲金音近三屆入圍藝人", "入圍作品_維基.json");
  const nominees = existsSync(nomFile) ? JSON.parse(readFileSync(nomFile, "utf8")).藝人 ?? {} : {};

  const result = {};
  const report = { ok: [], doubt: [], none: [], pending: [] };
  let n = 0;
  let quota = "";
  for (const p of people) {
    n++;
    if (quota) {
      report.pending.push({ slug: p.slug, name: p.name, reason: quota });
      continue;
    }
    try {
      await matchOne(p);
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e;
      quota = e.message;
      console.error(`\n${quota}：剩下的列「未比對」，之後重跑會從快取接著做`);
      report.pending.push({ slug: p.slug, name: p.name, reason: quota });
    }
  }
  async function matchOne(p) {
    const names = splitNames([p.name, ...JSON.parse(p.aliases || "[]")].filter(Boolean));
    const nameSet = new Set(names.map(norm).filter(Boolean));
    const intro = (() => {
      try {
        return JSON.parse(p.intro || "[]").join("\n");
      } catch {
        return "";
      }
    })();
    const known = [
      ...(seriesTitles.get(p.slug) ?? []),
      ...(nominees[p.slug]?.works ?? []),
      ...[...intro.matchAll(/《([^》]{1,60})》/g)].map((m) => m[1]),
      ...(picks.get(p.slug) ?? []).map((x) => x.title.replace(/\s*[-(（].*$/, "")),
    ];
    const done = (status, extra) => {
      const row = { slug: p.slug, name: p.name, ...extra };
      report[status].push(row);
      if (status === "ok") result[p.slug] = { spotifyId: extra.spotifyId, spotifyName: extra.spotifyName, source: extra.source, evidence: extra.evidence };
      console.log(`[${n}/${people.length}] ${p.name}：${status === "ok" ? `${extra.source} ${extra.spotifyId}` : status}${extra.reason ? `（${extra.reason}）` : ""}`);
    };

    const no = new Set(rejected[p.slug]?.ids ?? []);
    if (rejected[p.slug]?.all) {
      done("none", { reason: `使用者確認不配：${rejected[p.slug].reason ?? ""}` });
      return;
    }
    // 0. 手動指定
    if (manual[p.slug]?.spotifyId) {
      const a = await sp(`artists/${manual[p.slug].spotifyId}`);
      if (a) {
        done("ok", { spotifyId: a.id, spotifyName: a.name, source: "manual", evidence: manual[p.slug].evidence ?? "手動指定" });
        return;
      }
    }
    // 1. MusicBrainz 的 Spotify 連結
    let mbIds = [];
    if (p.mbid) {
      const a = await mb(`artist/${p.mbid}?inc=url-rels`);
      mbIds = [
        ...new Set(
          (a.relations ?? []).map((r) => r.url?.resource?.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})/)?.[1]).filter(Boolean),
        ),
      ].filter((id) => !no.has(id));
      if (mbIds.length === 1) {
        done("ok", { spotifyId: mbIds[0], spotifyName: "", source: "musicbrainz", evidence: `MusicBrainz ${p.mbid} 的 Spotify 連結` });
        return;
      }
    }
    // 2. 手動歌單的演出者
    const mine = picks.get(p.slug) ?? [];
    if (mine.length) {
      const ids = new Map();
      for (const x of mine) {
        const t = await sp(`tracks/${x.t}?market=TW`);
        const a = t?.artists?.[0];
        if (a) ids.set(a.id, a.name);
      }
      if (ids.size === 1) {
        const [[id, sname]] = [...ids];
        if (nameSet.has(norm(sname)) && !no.has(id)) {
          done("ok", { spotifyId: id, spotifyName: sname, source: "picks", evidence: `手動歌單 ${mine.length} 首的第一位演出者都是「${sname}」` });
          return;
        }
      }
    }
    // 3. 搜尋
    const cands = new Map();
    for (const nm of names) {
      const b = await sp(`search?q=${encodeURIComponent(nm)}&type=artist&limit=10&market=TW`);
      for (const a of b?.artists?.items ?? []) if (nameSet.has(norm(a.name)) && !no.has(a.id)) cands.set(a.id, a.name);
      if (cands.size) break;
    }
    if (mbIds.length > 1) for (const id of mbIds) cands.set(id, cands.get(id) ?? "(MusicBrainz 多個連結)");
    if (!cands.size) {
      done("none", { reason: "搜尋沒有同名藝人" });
      return;
    }
    const withHits = [];
    const searched = known.length ? await searchAlbums([names[0]]) : new Map();
    for (const [id, sname] of cands) {
      const titles = [...cachedAlbumTitles(id), ...(searched.get(id) ?? [])];
      const hits = known.length ? titleHit(known, titles) : [];
      withHits.push({ id, name: sname, hits: [...new Set(hits)].slice(0, 5), albums: [...new Set(titles)].slice(0, 6) });
    }
    const hitters = withHits.filter((c) => c.hits.length);
    if (hitters.length === 1) {
      const c = hitters[0];
      done("ok", { spotifyId: c.id, spotifyName: c.name, source: "search", evidence: `搜尋同名${cands.size > 1 ? `（${cands.size} 位同名，只有這位有作品交集）` : ""}，作品交集：${c.hits.join("、")}` });
      return;
    }
    done("doubt", {
      reason: !known.length ? "站上沒有已知作品可比" : hitters.length > 1 ? "多位同名候選都有作品交集" : cands.size > 1 ? `${cands.size} 位同名候選都沒有作品交集` : "同名候選沒有作品交集",
      known: [...new Set(known)].slice(0, 8),
      searched: names,
      candidates: withHits.map((c) => ({ id: c.id, name: c.name, url: `https://open.spotify.com/artist/${c.id}`, hits: c.hits, albums: c.albums })),
    });
  }
  // 同一個 Spotify ID 對到兩位站上藝人：兩位都改列疑義
  const byId = new Map();
  for (const [slug, v] of Object.entries(result)) byId.set(v.spotifyId, [...(byId.get(v.spotifyId) ?? []), slug]);
  for (const [id, slugs] of byId) {
    if (slugs.length < 2) continue;
    for (const s of slugs) {
      const i = report.ok.findIndex((r) => r.slug === s);
      const [r] = report.ok.splice(i, 1);
      report.doubt.push({ ...r, reason: `Spotify ID ${id} 同時對到 ${slugs.join("、")}` });
      delete result[s];
    }
  }
  writeFileSync(OUT, JSON.stringify({ _說明: "藝人識別碼 → Spotify 藝人 ID（scripts/spotify-match.mjs 產生；只有公開 ID，沒有金鑰）", 產生時間: new Date().toISOString(), artists: result }, null, 1) + "\n");
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        產生時間: new Date().toISOString(),
        統計: { 站上藝人: people.length, 對應成功: report.ok.length, 疑義: report.doubt.length, 找不到: report.none.length, 未比對: report.pending.length, 來源: countBy(report.ok, "source") },
        ...report,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`\n對應成功 ${report.ok.length}（${JSON.stringify(countBy(report.ok, "source"))}）、疑義 ${report.doubt.length}、找不到 ${report.none.length}、未比對 ${report.pending.length}；Spotify 連線 ${sstats.network}、快取 ${sstats.cached}、429 ${sstats.r429}`);
}
/** 中英連寫的名字拆開再搜（2026-10-03）：「JOLIN蔡依林」→ JOLIN、蔡依林；「楊淑喻（吉那）」→ 楊淑喻、吉那；「Yufu／陳郁夫」→ 兩段。原名保留排最前，拆出來的段落只在長度 ≥2 才算 */
export function splitNames(names) {
  const out = [];
  const add = (x) => {
    const t = x.replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const nm of names) {
    add(nm);
    const parts = [];
    // 括號裡的別名（全形或半形）
    for (const m of nm.matchAll(/[（(]([^（）()]{1,40})[）)]/g)) parts.push(m[1]);
    const base = nm.replace(/[（(][^（）()]{1,40}[）)]/g, " ");
    // ／、/、｜ 分隔
    for (const seg of base.split(/[／/｜|]/)) {
      parts.push(seg);
      // 拉丁段 + 中文段（或反過來）：在中文與拉丁字母的交界切開
      const cjk = /[\u3400-\u9fff\uf900-\ufaff\u3005\u30fb\u00b7]/;
      const lat = /[A-Za-z0-9]/;
      let cur = "";
      let kind = "";
      for (const ch of seg) {
        const k = cjk.test(ch) ? "c" : lat.test(ch) ? "l" : "";
        if (k && kind && k !== kind) {
          parts.push(cur);
          cur = "";
        }
        if (k) kind = k;
        cur += ch;
      }
      parts.push(cur);
    }
    for (const x of parts) if (x.replace(/[\s.'!&·．]/g, "").length >= 2) add(x);
  }
  return out;
}
const countBy = (xs, k) => xs.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});

/** 比對時已經完整分頁抓過的專輯清單（全在快取裡才算）：寫進 D1 省掉排程的額度。回傳 { ids, at } 或 null */
function cachedAlbumList(id) {
  const ids = [];
  let at = "";
  for (let offset = 0; offset < 500; offset += 10) {
    const url = `https://api.spotify.com/v1/artists/${id}/albums?include_groups=album,single&market=TW&limit=10&offset=${offset}`;
    const file = join(CACHE, `${createHash("sha1").update(url).digest("hex")}.json`);
    if (!existsSync(file)) return null;
    const c = JSON.parse(readFileSync(file, "utf8"));
    if (!c.body) return null;
    ids.push(...c.body.items.map((a) => a.id));
    if (!at || c.fetchedAt < at) at = c.fetchedAt;
    if (!c.body.next) return { ids: [...new Set(ids)], at };
  }
  return null;
}

function applyToDb() {
  const { artists } = JSON.parse(readFileSync(OUT, "utf8"));
  const rows = Object.entries(artists);
  let seeded = 0;
  const st = rows.map(
    ([slug, v]) =>
      `INSERT INTO spotify_artists (artist_slug, spotify_id, source, evidence) VALUES (${q(slug)}, ${q(v.spotifyId)}, ${q(v.source)}, ${q(v.evidence)}) ` +
      `ON CONFLICT(artist_slug) DO UPDATE SET spotify_id=excluded.spotify_id, source=excluded.source, evidence=excluded.evidence, ` +
      `albums=CASE WHEN spotify_artists.spotify_id=excluded.spotify_id THEN spotify_artists.albums ELSE NULL END, ` +
      `albums_at=CASE WHEN spotify_artists.spotify_id=excluded.spotify_id THEN spotify_artists.albums_at ELSE NULL END, ` +
      `updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  for (const [slug, v] of rows) {
    const c = cachedAlbumList(v.spotifyId);
    if (!c) continue;
    seeded++;
    // 只在 D1 還沒有清單時補（排程抓過的比較新，不蓋掉）
    st.push(`UPDATE spotify_artists SET albums=${q(JSON.stringify(c.ids))}, albums_at=${q(c.at)} WHERE artist_slug=${q(slug)} AND spotify_id=${q(v.spotifyId)} AND albums IS NULL`);
  }
  console.log(`快取裡有完整專輯清單的藝人 ${seeded} 位，補進 D1（原本沒有清單的才補）`);
  // 不在對應檔裡的藝人（改判疑義、藝人被刪）：停用自動抽歌，已抽過的紀錄保留。
  // Worker 自動比對寫的（source='auto'，2026-10-03 起）不在這個檔裡，不停用
  st.push(`UPDATE spotify_artists SET enabled=0 WHERE source <> 'auto' AND artist_slug NOT IN (${rows.map(([s]) => q(s)).join(", ") || "''"})`);
  // 使用者確認整位不配的：就算以前配過也停用
  const allNo = Object.entries(rejected).filter(([, v]) => v.all).map(([s]) => s);
  if (allNo.length) st.push(`UPDATE spotify_artists SET enabled=0 WHERE artist_slug IN (${allNo.map(q).join(", ")})`);
  st.push(`UPDATE spotify_artists SET enabled=1 WHERE artist_slug IN (${rows.map(([s]) => q(s)).join(", ") || "''"})`);
  const file = join(root, ".wrangler", "spotify-artists.sql");
  writeFileSync(file, st.join(";\n") + ";\n");
  const r = wrangler(["d1", "execute", "DB", ...target, "--file", file, ...(remote ? ["--yes"] : [])]);
  if (r.status !== 0) throw new Error("寫入 spotify_artists 失敗");
  const [c] = query(`SELECT COUNT(*) AS n, SUM(enabled) AS on_ FROM spotify_artists`);
  console.log(`spotify_artists：${c.n} 列、啟用 ${c.on_}`);
}

/** 使用者的判斷 → spotify_match（Worker 自動比對讀這張）。整位不配＝rejected；不是本人的 ID 與出現時才用的 ID 先存著（waiting），不改既有狀態 */
function decisionsSql() {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const st = [];
  for (const [slug, v] of Object.entries(rejected)) {
    if (v.all)
      st.push(
        `INSERT INTO spotify_match (artist_slug, status, reason, outcome, note) VALUES (${q(slug)}, 'rejected', 'manual', 'rejected', ${q(v.reason ?? "使用者確認不配")}) ` +
          `ON CONFLICT(artist_slug) DO UPDATE SET status='rejected', outcome='rejected', note=excluded.note, updated_at=${now}`,
      );
    else
      st.push(
        `INSERT INTO spotify_match (artist_slug, status, reason, rejected_ids, note) VALUES (${q(slug)}, 'waiting', 'manual', ${q(JSON.stringify(v.ids ?? []))}, ${q(v.reason ?? "")}) ` +
          `ON CONFLICT(artist_slug) DO UPDATE SET rejected_ids=excluded.rejected_ids, updated_at=${now}`,
      );
  }
  for (const [slug, v] of Object.entries(manualAll.whenVisible ?? {}))
    st.push(
      `INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES (${q(slug)}, 'waiting', 'manual', ${q(v.spotifyId)}, ${q(v.evidence ?? "")}) ` +
        `ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=${now}`,
    );
  return st;
}
if (argv.includes("--print-decisions")) {
  console.log(decisionsSql().join(";\n--> statement-breakpoint\n") + ";");
  process.exit(0);
}
if (argv.includes("--sync-decisions")) {
  const file = join(root, ".wrangler", "spotify-decisions.sql");
  writeFileSync(file, decisionsSql().join(";\n") + ";\n");
  const r = wrangler(["d1", "execute", "DB", ...target, "--file", file, ...(remote ? ["--yes"] : [])]);
  if (r.status !== 0) throw new Error("寫入 spotify_match 失敗");
  console.log(`spotify_match：${JSON.stringify(query(`SELECT status, COUNT(*) AS n FROM spotify_match GROUP BY status`))}`);
  process.exit(0);
}
if (!applyOnly) await match();
if (apply) applyToDb();
