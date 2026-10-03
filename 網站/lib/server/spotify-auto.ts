// Spotify 藝人自動比對（2026-10-03）。原則（使用者 10/03）：藝人頁有對外顯示的才配，沒顯示的等真的出現再配。
//
// 觸發：
//   A. 藝人頁從不顯示變顯示：內容目錄每次重組（lib/server/content.ts，內容版本一變就重組）算一次「顯示中的藝人」，
//      清單有變就存 spotify_state 的 visible，同一句 SQL 替「顯示中、沒有 Spotify ID、還沒排過」的藝人排一筆工作（spotify_match）。
//      使用者先判斷過、在等出現的（waiting）也在這時轉成排隊
//   B. 每月一次（每天 02:00 的排程看這個月開過沒）：顯示中、比對過但還沒對到的，全部重排再比一次（Spotify 上可能後來才出現）
// 執行：`*/10` 排程在自動補資料之前跑一小批，跟自動補資料共用排程鎖（autofill_state 的 lock）與 MusicBrainz 每秒 1 次的計時；
//   Spotify 記在抽歌的配額帳（spotify_state 的 used:search:日期，每天上限 DAILY_LIMIT.search），每秒最多 1 次，只打 search，
//   不打 artist-albums。任何 429 立刻停、把 search 桶鎖到 Retry-After 之後，記在 auto_last。抽歌時段（台灣 02:00～04:59）不跑，避免兩邊同時打。
//
// 規則（第一輪＋第二輪，高信心才寫，其餘不配）：
//   0. 使用者先確認過的 ID（preset_id）→ 直接用
//   1. MusicBrainz 藝人頁恰好一個 open.spotify.com/artist 連結
//   2. Wikidata P1902（QID 來自 MusicBrainz 的 Wikidata 連結或站上維基條目）恰好一個
//   3. Spotify 搜名字（含拆開的中英名），名稱完全相同的候選裡，恰好一位的專輯標題跟站上已知作品有交集
//   4. 拿站上已知作品標題搜 Spotify（album＋track），同一位演出者命中 ≥2 個作品，或命中 1 個且名稱相符
//   使用者確認不是本人的 ID（rejected_ids）、已經配給別位藝人的 ID 一律不用；整位不配（status＝rejected）的不碰。
// 寫進 spotify_artists（source＝auto），albums 留空，每晚 02:00 抽歌排程照常接手。有寫入就讓 content_version 加 1 一次，藝人頁換上播放器。

import { env, waitUntil } from "cloudflare:workers";
import { mb, mnorm, OutOfBudget, Busy, type Budget } from "@/lib/server/autofill-mb";
import { dropLock, takeLock } from "@/lib/server/autofill";
import { closeLedger, DAILY_LIMIT, NoBudget, openLedger, RateLimited, setState, sp, type Ledger } from "@/lib/server/spotify-draw";

const db = () => env.DB!;
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "Lemibox/0.1 ( https://lemibox.com )";
const ID22 = /^[A-Za-z0-9]{22}$/;
/** 台灣時間的年月 */
const twMonth = (t = Date.now()) => new Date(t + 8 * 3600_000).toISOString().slice(0, 7);

/* =====================================================================
 * 觸發 A：顯示中的藝人清單有變 → 排工作
 * ===================================================================== */

let lastVisible = "";

/** 內容目錄重組後呼叫（slugs＝顯示中的藝人，只算藝人不算發行單位）。同一個 isolate 清單沒變就不寫 */
export function noteVisible(slugs: string[]) {
  const json = JSON.stringify([...slugs].sort());
  if (json === lastVisible) return;
  lastVisible = json;
  const t = nowIso();
  const work = db()
    .batch([
      db()
        .prepare(
          `INSERT INTO spotify_state (key, value, updated_at) VALUES ('visible', ?1, ?2)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE spotify_state.value <> excluded.value`,
        )
        .bind(json, t),
      // 顯示中、沒有啟用的 Spotify ID：沒排過的排一筆；使用者先判斷過、在等出現的（waiting）轉成排隊。其他狀態（done、rejected）不動
      db()
        .prepare(
          `INSERT INTO spotify_match (artist_slug, status, reason, next_at, created_at, updated_at)
           SELECT j.value, 'queued', 'visible', ?2, ?2, ?2 FROM json_each(?1) j
           WHERE NOT EXISTS (SELECT 1 FROM spotify_artists sa WHERE sa.artist_slug = j.value AND sa.enabled = 1)
           ON CONFLICT(artist_slug) DO UPDATE SET status = 'queued', reason = 'visible', next_at = excluded.next_at, updated_at = excluded.updated_at
           WHERE spotify_match.status = 'waiting'`,
        )
        .bind(json, t),
    ])
    .catch((e) => {
      lastVisible = "";
      console.error("[Spotify 自動比對] 記錄顯示中藝人失敗", e);
    });
  try {
    waitUntil(work);
  } catch {
    /* 不在請求裡（建置時）：不用等 */
  }
}

/* =====================================================================
 * 觸發 B：每月一次
 * ===================================================================== */

/** 每天 02:00 的排程呼叫：這個月還沒開過，就把顯示中、比對過但沒對到的全部重排。回傳排了幾位（沒開回 -1） */
export async function startSpotifyMonthly(now = Date.now(), force = false) {
  const month = twMonth(now);
  const cur = await db().prepare(`SELECT value FROM spotify_state WHERE key = 'auto_month'`).first<{ value: string }>();
  if (cur?.value === month && !force) return -1;
  const t = new Date(now).toISOString();
  const [, r] = await db().batch([
    setState("auto_month", month),
    db()
      .prepare(
        `UPDATE spotify_match SET status = 'queued', reason = 'monthly', next_at = ?1, updated_at = ?1
         WHERE status = 'done'
           AND artist_slug IN (SELECT j.value FROM spotify_state s, json_each(s.value) j WHERE s.key = 'visible')
           AND NOT EXISTS (SELECT 1 FROM spotify_artists sa WHERE sa.artist_slug = spotify_match.artist_slug AND sa.enabled = 1)`,
      )
      .bind(t),
  ]);
  return r.meta.changes ?? 0;
}

/* =====================================================================
 * 執行
 * ===================================================================== */

type ArtistRow = { slug: string; name: string; aliases: string | null; mbid: string | null; wiki_url: string | null; intro: string | null; status: string; deleted_at: string | null; hidden_at: string | null; kind: string };
type MatchRow = { artist_slug: string; reason: string; preset_id: string | null; preset_note: string; rejected_ids: string; tries: number };
type Outcome = { outcome: "matched" | "none" | "doubt" | "shell" | "gone"; spotifyId?: string; source?: string; note: string };
export type AutoRun = { at: string; checked: number; matched: { slug: string; name: string; spotifyId: string; source: string }[]; stopped: string; calls: number; queued: number };

const J = <T>(s: string | null | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};
const hasCJK = (s: string) => /[㐀-鿿]/.test(s);

/** 中英連寫、括號別名、／分隔的名字拆開（跟 scripts/spotify-match.mjs 的 splitNames 同一套） */
export function splitNames(names: string[]) {
  const out: string[] = [];
  const add = (x: string) => {
    const t = x.replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const cjk = /[㐀-鿿豈-﫿々・·]/;
  const lat = /[A-Za-z0-9]/;
  for (const nm of names) {
    add(nm);
    const parts: string[] = [];
    for (const m of nm.matchAll(/[（(]([^（）()]{1,40})[）)]/g)) parts.push(m[1]);
    const base = nm.replace(/[（(][^（）()]{1,40}[）)]/g, " ");
    for (const seg of base.split(/[／/｜|]/)) {
      parts.push(seg);
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

/** 名稱比對用（第一輪的 norm：去空白與標點、小寫、簡轉繁） */
const nname = (s: string) => mnorm(s);
/** 作品標題交集（第一輪 titleHit）：相等，或長度 ≥3 的一方包含另一方 */
const titleHit = (known: string[], titles: string[]) => {
  const k = known.map(mnorm).filter((x) => x.length >= 2);
  return titles.filter((t) => {
    const n = mnorm(t);
    return n.length >= 2 && k.some((x) => x === n || (x.length >= 3 && n.includes(x)) || (n.length >= 3 && x.includes(n)));
  });
};
/** 標題相同（第二輪 sameTitle）：去掉括號段後正規化相等；中文標題後面接羅馬拼音也算 */
const sameTitle = (known: string, got: string) => {
  const k = mnorm(known);
  const g = mnorm(String(got ?? "").replace(/\s*[（(\[【].*$/u, ""));
  if (k.length < 2) return false;
  if (k === g) return true;
  if (hasCJK(known) && g.startsWith(k) && !hasCJK(g.slice(k.length))) return true;
  return false;
};
const cleanTitle = (t: string) => {
  const x = t.replace(/\s*[（(][^（）()]*(專輯|單曲)[）)]\s*/g, " ").replace(/\s+/g, " ").trim();
  const half = x.slice(0, Math.floor(x.length / 2)).trim();
  return half && x === `${half} ${half}` ? half : x;
};

/** Wikidata／維基 API（失敗回 null 不中斷），算進這次的對外連線數 */
async function wget<T>(b: Budget, url: string): Promise<T | null> {
  if (b.calls >= b.maxCalls || Date.now() + 1500 > b.deadline) throw new OutOfBudget("這次執行的額度用完");
  b.calls++;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type SpArtist = { id: string; name: string; images?: unknown[] };
type SpAlbum = { name: string; artists?: SpArtist[] };

async function matchOne(b: Budget, spot: <T>(path: string) => Promise<T | null>, a: ArtistRow, job: MatchRow, taken: Map<string, string>): Promise<Outcome> {
  const no = new Set(J<string[]>(job.rejected_ids, []));
  const ok = (id: string) => ID22.test(id) && !no.has(id) && (!taken.has(id) || taken.get(id) === a.slug);
  // 0. 使用者先確認過的
  if (job.preset_id && ok(job.preset_id)) return { outcome: "matched", spotifyId: job.preset_id, source: "preset", note: job.preset_note || "使用者確認過的 ID" };

  const names = splitNames([a.name, ...J<string[]>(a.aliases, [])].filter(Boolean)).slice(0, 4);
  const nameSet = new Set(names.map(nname).filter(Boolean));
  const intro = J<string[]>(a.intro, []).join("\n");
  const series = (
    await db().prepare(`SELECT title FROM series WHERE artist_slug = ?1 AND deleted_at IS NULL AND status = 'approved' ORDER BY year`).bind(a.slug).all<{ title: string }>()
  ).results.map((r) => r.title);
  const picks = (await db().prepare(`SELECT title FROM spotify_picks WHERE artist_slug = ?1`).bind(a.slug).all<{ title: string }>()).results.map((r) =>
    r.title.replace(/\s*[-(（].*$/, ""),
  );
  const known = [...new Set([...series, ...[...intro.matchAll(/《([^》]{1,60})》/g)].map((m) => m[1]), ...picks])];

  // 1. MusicBrainz 的 Spotify 連結（順便拿 Wikidata QID）
  let qid = "";
  if (a.mbid) {
    const r = await mb<{ relations?: { url?: { resource: string } }[] }>(b, `artist/${a.mbid}?inc=url-rels`);
    const res = (r?.relations ?? []).map((x) => x.url?.resource ?? "");
    const ids = [...new Set(res.map((u) => u.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})/)?.[1]).filter((x): x is string => !!x))].filter(ok);
    qid = res.map((u) => u.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1]).find(Boolean) ?? "";
    if (ids.length === 1) return { outcome: "matched", spotifyId: ids[0], source: "musicbrainz", note: `MusicBrainz ${a.mbid} 的 Spotify 連結` };
  }
  // 2. Wikidata P1902
  if (!qid && a.wiki_url) {
    const title = (() => {
      try {
        return decodeURIComponent((a.wiki_url.match(/\/wiki\/([^?#]+)/) ?? [])[1] ?? "");
      } catch {
        return "";
      }
    })();
    if (title) {
      const r = await wget<{ query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> } }>(
        b,
        `https://zh.wikipedia.org/w/api.php?format=json&action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=${encodeURIComponent(title)}`,
      );
      qid = Object.values(r?.query?.pages ?? {})[0]?.pageprops?.wikibase_item ?? "";
    }
  }
  if (qid) {
    const r = await wget<{ claims?: { P1902?: { mainsnak?: { datavalue?: { value?: string } } }[] } }>(
      b,
      `https://www.wikidata.org/w/api.php?format=json&action=wbgetclaims&entity=${qid}&property=P1902`,
    );
    const ids = [...new Set((r?.claims?.P1902 ?? []).map((c) => c.mainsnak?.datavalue?.value ?? "").filter(ok))];
    if (ids.length === 1) return { outcome: "matched", spotifyId: ids[0], source: "wikidata", note: `Wikidata ${qid} 的 P1902 Spotify artist ID` };
  }
  // 3. 搜名字：名稱完全相同的候選，專輯標題跟已知作品有交集的恰好一位
  const cands = new Map<string, SpArtist>();
  for (const nm of names.slice(0, 3)) {
    const r = await spot<{ artists?: { items?: SpArtist[] } }>(`search?q=${encodeURIComponent(nm)}&type=artist&limit=10&market=TW`);
    for (const x of r?.artists?.items ?? []) if (nameSet.has(nname(x.name)) && ok(x.id)) cands.set(x.id, x);
    if (cands.size) break;
  }
  if (cands.size && known.length) {
    const r = await spot<{ albums?: { items?: SpAlbum[] } }>(`search?q=${encodeURIComponent(`artist:${names[0]}`)}&type=album&limit=10&market=TW`);
    const by = new Map<string, string[]>();
    for (const al of r?.albums?.items ?? []) for (const x of al.artists ?? []) by.set(x.id, [...(by.get(x.id) ?? []), al.name]);
    const hitters = [...cands.values()].map((c) => ({ c, hits: titleHit(known, by.get(c.id) ?? []) })).filter((x) => x.hits.length);
    if (hitters.length === 1)
      return { outcome: "matched", spotifyId: hitters[0].c.id, source: "search", note: `搜尋同名「${hitters[0].c.name}」，作品交集：${[...new Set(hitters[0].hits)].slice(0, 3).join("、")}` };
  }
  // 4. 拿已知作品標題搜（最多 3 次；已有一位名稱不同的命中 1 個時多給 1 次）
  const titles: string[] = [];
  for (const t of known) {
    const c = cleanTitle(t);
    if (!c || mnorm(c).length < 2 || titles.some((x) => mnorm(x) === mnorm(c))) continue;
    if (!hasCJK(c) && mnorm(c).length < 4) continue;
    titles.push(c);
  }
  const artistOk = (x: SpArtist) => [...nameSet].some((nm) => nname(x.name) === nm || ((hasCJK(nm) ? nm.length >= 2 : nm.length >= 4) && nname(x.name).includes(nm)));
  const found = new Map<string, { name: string; nameOk: boolean; hits: Set<string> }>();
  const strong = () => [...found].filter(([id, v]) => ok(id) && (v.hits.size >= 2 || v.nameOk));
  let calls = 0;
  for (const t of titles) {
    const limit = [...found.values()].some((v) => v.hits.size === 1 && !v.nameOk) ? 4 : 3;
    if (calls >= limit || strong().length) break;
    const r = await spot<{ albums?: { items?: SpAlbum[] }; tracks?: { items?: SpAlbum[] } }>(`search?q=${encodeURIComponent(`${t} ${names[0]}`)}&type=album,track&limit=10&market=TW`);
    calls++;
    for (const it of [...(r?.albums?.items ?? []), ...(r?.tracks?.items ?? [])]) {
      const k = titles.find((x) => sameTitle(x, it.name));
      if (!k) continue;
      for (const x of it.artists ?? []) {
        const cur = found.get(x.id) ?? { name: x.name, nameOk: artistOk(x), hits: new Set<string>() };
        cur.hits.add(k);
        found.set(x.id, cur);
      }
    }
  }
  let st = strong();
  if (st.length > 1 && st.filter(([, v]) => v.nameOk).length === 1) st = st.filter(([, v]) => v.nameOk);
  if (st.length === 1) {
    const [id, v] = st[0];
    return { outcome: "matched", spotifyId: id, source: "search-title", note: `用站上作品搜，演出者「${v.name}」${v.nameOk ? "（名稱相符）" : ""}有 ${v.hits.size} 個同名作品：${[...v.hits].slice(0, 3).join("、")}` };
  }
  if (!cands.size && !found.size) return { outcome: "none", note: "Spotify 搜不到同名藝人，作品標題也對不到" };
  const real = [...cands.values()].filter((c) => (c.images ?? []).length);
  if (cands.size && !real.length && !found.size) return { outcome: "shell", note: `同名候選 ${cands.size} 位都沒有照片，作品也對不到` };
  return { outcome: "doubt", note: `同名候選 ${cands.size} 位、作品標題命中 ${found.size} 位，證據不夠，不配` };
}

/**
 * 跑一小批（`*／10` 排程在自動補資料前呼叫；後台也可手動呼叫）。回傳這次用掉的對外連線數，讓自動補資料扣掉。
 * 抽歌時段（UTC 18:00～20:59）不跑。
 */
export async function runSpotifyAuto({ ms = 45_000, maxCalls = 20, now = Date.now(), force = false }: { ms?: number; maxCalls?: number; now?: number; force?: boolean } = {}): Promise<AutoRun & { skipped?: string }> {
  const run: AutoRun = { at: new Date(now).toISOString(), checked: 0, matched: [], stopped: "", calls: 0, queued: 0 };
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return { ...run, skipped: "沒有設定 Spotify 金鑰" };
  const h = new Date(now).getUTCHours();
  if (!force && h >= 18 && h <= 20) return { ...run, skipped: "抽歌時段不跑" };
  const t = nowIso();
  const first = await db().prepare(`SELECT 1 AS x FROM spotify_match WHERE status = 'queued' AND next_at <= ?1 LIMIT 1`).bind(t).first();
  if (!first) return { ...run, skipped: "沒有工作" };
  if (!(await takeLock(ms))) return { ...run, skipped: "排程鎖在別人手上" };

  const start = Date.now();
  const last = await db().prepare(`SELECT value FROM autofill_state WHERE key = 'mb_last'`).first<{ value: string }>();
  const b: Budget = { calls: 0, maxCalls, deadline: start + ms, mbLast: Number(last?.value) || 0 };
  const l: Ledger = await openLedger(now, 1000);
  // search 桶鎖住中（之前 429）或今天額度用完：整批不跑，連 MusicBrainz／Wikidata 也不打
  if ((l.lockedUntil.search && Date.parse(l.lockedUntil.search) > now) || l.used.search >= DAILY_LIMIT.search - 8) {
    await dropLock();
    return { ...run, skipped: l.lockedUntil.search ? `Spotify 搜尋鎖到 ${l.lockedUntil.search}` : "今天的 Spotify 搜尋額度用完" };
  }
  let spLast = 0;
  /** Spotify search：每秒最多 1 次，算進這次的對外連線數 */
  const spot = async <T,>(path: string): Promise<T | null> => {
    if (b.calls >= b.maxCalls - 1 || Date.now() + 2500 > b.deadline) throw new OutOfBudget("這次執行的額度用完");
    const wait = spLast + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    spLast = Date.now();
    const before = l.calls;
    try {
      return await sp<T>(path, "search", l);
    } finally {
      b.calls += l.calls - before;
    }
  };
  const writes: D1PreparedStatement[] = [];
  try {
    const taken = new Map(
      (await db().prepare(`SELECT spotify_id AS id, artist_slug AS slug FROM spotify_artists WHERE enabled = 1`).all<{ id: string; slug: string }>()).results.map((r) => [r.id, r.slug]),
    );
    for (;;) {
      // 一位藝人最多約 12 次連線：剩不到就留給下一次
      if (b.calls > maxCalls - 12 && run.checked > 0) break;
      const job = await db()
        .prepare(`SELECT artist_slug, reason, preset_id, preset_note, rejected_ids, tries FROM spotify_match WHERE status = 'queued' AND next_at <= ?1 ORDER BY next_at, artist_slug LIMIT 1`)
        .bind(nowIso())
        .first<MatchRow>();
      if (!job) break;
      const a = await db()
        .prepare(`SELECT slug, name, aliases, mbid, wiki_url, intro, status, deleted_at, hidden_at, kind FROM artists WHERE slug = ?1`)
        .bind(job.artist_slug)
        .first<ArtistRow>();
      let out: Outcome;
      if (!a || a.kind !== "藝人" || a.status !== "approved" || a.deleted_at || a.hidden_at) out = { outcome: "gone", note: "藝人已刪除、隱藏或不是藝人" };
      else out = await matchOne(b, spot, a, job, taken);
      run.checked++;
      const ts = nowIso();
      if (out.outcome === "matched" && out.spotifyId) {
        taken.set(out.spotifyId, job.artist_slug);
        run.matched.push({ slug: job.artist_slug, name: a?.name ?? job.artist_slug, spotifyId: out.spotifyId, source: out.source ?? "" });
        await db().batch([
          db()
            .prepare(
              `INSERT INTO spotify_artists (artist_slug, spotify_id, source, evidence, enabled) VALUES (?1, ?2, 'auto', ?3, 1)
               ON CONFLICT(artist_slug) DO UPDATE SET spotify_id = excluded.spotify_id, source = 'auto', evidence = excluded.evidence, enabled = 1,
                 albums = CASE WHEN spotify_artists.spotify_id = excluded.spotify_id THEN spotify_artists.albums ELSE NULL END,
                 albums_at = CASE WHEN spotify_artists.spotify_id = excluded.spotify_id THEN spotify_artists.albums_at ELSE NULL END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
            )
            .bind(job.artist_slug, out.spotifyId, `自動比對 ${out.source}（${job.reason === "monthly" ? "每月重跑" : "藝人頁出現"}）：${out.note}（${ts.slice(0, 10)}）`.slice(0, 500)),
          db()
            .prepare(`UPDATE spotify_match SET status = 'done', outcome = 'matched', spotify_id = ?2, note = ?3, checked_at = ?4, updated_at = ?4, tries = tries + 1 WHERE artist_slug = ?1`)
            .bind(job.artist_slug, out.spotifyId, `${out.source}：${out.note}`.slice(0, 500), ts),
        ]);
      } else {
        await db()
          .prepare(`UPDATE spotify_match SET status = 'done', outcome = ?2, note = ?3, checked_at = ?4, updated_at = ?4, tries = tries + 1 WHERE artist_slug = ?1`)
          .bind(job.artist_slug, out.outcome, out.note.slice(0, 500), ts)
          .run();
      }
    }
  } catch (e) {
    if (e instanceof RateLimited) {
      // 429：立刻停，search 桶已鎖到 Retry-After 之後（closeLedger 寫回）；這位留在佇列，鎖解開後再跑
      run.stopped = e.message;
      const until = l.lockedUntil.search ?? new Date(Date.now() + e.retryAfter * 1000).toISOString();
      writes.push(db().prepare(`UPDATE spotify_match SET next_at = ?1 WHERE status = 'queued' AND next_at < ?1`).bind(until));
      console.warn(`[Spotify 自動比對] ${e.message}，停止`);
    } else if (e instanceof NoBudget) run.stopped = "今天的 Spotify 搜尋額度用完或鎖住中";
    else if (e instanceof OutOfBudget) run.stopped = "";
    else if (e instanceof Busy) run.stopped = `MusicBrainz 忙線：${e.message}`;
    else {
      run.stopped = `出錯：${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
      console.error("[Spotify 自動比對] 失敗", e);
    }
  } finally {
    run.calls = b.calls;
    run.queued = (await db().prepare(`SELECT COUNT(*) AS n FROM spotify_match WHERE status = 'queued'`).first<{ n: number }>())?.n ?? 0;
    writes.push(...closeLedger(l));
    if (run.matched.length) writes.push(db().prepare(`UPDATE content_version SET v = v + 1 WHERE id = 1`));
    // 累計：這個月對到幾位（後台顯示用）
    if (run.checked || run.stopped) writes.push(setState("auto_last", JSON.stringify(run)));
    writes.push(
      db()
        .prepare(`INSERT INTO autofill_state (key, value) VALUES ('mb_last', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?2`)
        .bind(String(b.mbLast), nowIso()),
    );
    await db().batch(writes);
    await dropLock();
  }
  return run;
}

/* =====================================================================
 * 後台狀態
 * ===================================================================== */

export type UnmatchedRow = { slug: string; name: string; status: string | null; outcome: string | null; note: string; checkedAt: string | null };

export async function autoStatus() {
  const [state, unmatched, autoCount, queue] = await Promise.all([
    db().prepare(`SELECT key, value, updated_at FROM spotify_state WHERE key IN ('auto_last', 'auto_month', 'visible')`).all<{ key: string; value: string; updated_at: string }>(),
    db()
      .prepare(
        `SELECT a.slug, a.name, m.status, m.outcome, COALESCE(m.note, '') AS note, m.checked_at AS checkedAt
         FROM spotify_state s, json_each(s.value) j JOIN artists a ON a.slug = j.value
         LEFT JOIN spotify_match m ON m.artist_slug = a.slug
         WHERE s.key = 'visible' AND NOT EXISTS (SELECT 1 FROM spotify_artists sa WHERE sa.artist_slug = a.slug AND sa.enabled = 1)
         ORDER BY a.name`,
      )
      .all<UnmatchedRow>(),
    db().prepare(`SELECT COUNT(*) AS n FROM spotify_artists WHERE source = 'auto' AND enabled = 1`).first<{ n: number }>(),
    db().prepare(`SELECT status, COUNT(*) AS n FROM spotify_match GROUP BY status`).all<{ status: string; n: number }>(),
  ]);
  const m = new Map(state.results.map((r) => [r.key, r]));
  const visible = J<string[]>(m.get("visible")?.value, []);
  return {
    last: J<AutoRun | null>(m.get("auto_last")?.value, null),
    month: m.get("auto_month")?.value ?? null,
    visible: visible.length,
    visibleAt: m.get("visible")?.updated_at ?? null,
    autoMatched: autoCount?.n ?? 0,
    queue: Object.fromEntries(queue.results.map((r) => [r.status, r.n])) as Record<string, number>,
    unmatched: unmatched.results,
  };
}
