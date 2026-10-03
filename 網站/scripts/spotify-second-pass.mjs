// Spotify 疑義藝人第二輪自動判定（2026-10-03）。本機跑，不是 Worker。
//
// 第一輪（spotify-match.mjs）列「疑義」的藝人，用額外證據再判一次，能確定的寫進 scripts/spotify-manual.json，
// 剩下的整理成一份精簡版清單給使用者看。證據依序：
//   1. Wikidata P1902（Spotify artist ID）：QID 來源＝MusicBrainz 的 Wikidata 連結、10/1 補匯的 .cache/wikidata/pending-result.json、
//      站上 wiki_url（維基條目 → pageprops.wikibase_item）。有 P1902 就是鐵證
//   1b. Wikidata 同名項目：wbsearchentities 找跟站上名稱完全相同的項目，它的 P1902 正好是第一輪的同名候選之一 → 採用
//   2. MusicBrainz url-rels 重查（不讀快取）：恰好一個 open.spotify.com/artist 連結 → 採用
//   2b. Spotify 以作品標題搜尋（search type=album／track，q=作品標題＋藝人名，每位最多 3 次）：第一輪只用「artist:名」抓前 10 張，
//      作品多的藝人會漏；這裡改拿站上已知作品（系列標題優先，跨藝人共用的合輯標題不用）去搜，搜到的作品標題完全相同、
//      演出者名稱＝站上名稱（或包含站上名稱，像「李英宏 aka DJ Didilong」）→ 採用那位演出者
//   3. 單一候選、名稱有中文、站上沒有已知作品、候選有作品（Spotify 搜尋抓得到專輯／單曲）→ 採用
//      ※ 原規格還有「Spotify genres 含 taiwan／mandopop…」一條，但這個 app 的 Spotify 回應已經沒有 genres／followers／popularity 欄位
//        （search 與 get artist 都只回 id、name、images、外部連結），這條用不上，在報告裡註明
//   4. 多位候選：只有一位有作品且有照片、其他全是沒作品沒照片的空殼 → 採用那位；否則留給使用者
// Spotify 只打 search（每秒 ≤1、有快取、任何 429 立刻停用 Spotify、其他證據照跑）；之後 spotify-match.mjs --apply 會對手動指定的 ID 各打一次 get artist。
//
// 用法（在 網站/ 底下；要 CLOUDFLARE_API_TOKEN／CLOUDFLARE_ACCOUNT_ID 讀正式站、SPOTIFY_CLIENT_ID／SECRET 搜 Spotify）：
//   node scripts/spotify-second-pass.mjs --remote [--write] [--report <第一輪報告.json>]
//   --write 才寫 spotify-manual.json 與精簡版清單；--report 指定第一輪報告（spotify-match.mjs --apply 之後報告會把手動指定的算進 ok、
//   疑義只剩沒採用的，要重現完整 98 位的判定就用 git 裡 apply 前的那份）
//   --slugs a,b,c（2026-10-03 加）：只判這幾位（第一輪是疑義的用報告裡的候選，「找不到」的用站上名稱＋別名從頭搜），
//   結果寫 產出/20261003_Spotify補對/顯示中補對.json，不動精簡版清單；使用者確認不配的（spotify-manual.json 的 rejected）一律不採用

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mb } from "./musicbrainz-fetch.mjs";

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("要指定 --remote 或 --local");
  process.exit(2);
}
const write = argv.includes("--write");
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = opt("--report", join(root, "..", "產出", "20260930_Spotify自動抽歌", "藝人對應報告.json"));
const OUTDIR = join(root, "..", "產出", "20261003_Spotify補對");
const MANUAL = join(root, "scripts", "spotify-manual.json");
const SPCACHE = join(root, ".cache", "spotify");
const WDCACHE = join(root, ".cache", "wikidata");
const UA = "Lemibox/0.1 ( https://lemibox.com )";

const wrangler = (args) =>
  spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const target = remote ? ["--remote", "--config", "wrangler.production.jsonc"] : ["--local", "--config", "wrangler.local.jsonc"];
const query = (sql) => {
  const r = wrangler(["d1", "execute", "DB", ...target, "--json", "--command", sql]);
  if (r.status !== 0) throw new Error(`查詢失敗：${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0].results;
};

/* ---------- 通用抓取（每秒 1 次、有快取） ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
const stats = { wd: 0, wp: 0, mb: 0 };
async function getJson(url, cacheDir, key) {
  const file = join(cacheDir, `${createHash("sha1").update(url).digest("hex")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).body;
  const wait = last + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  stats[key]++;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (r.status === 429 || r.status >= 500) {
      await sleep(2 ** (attempt + 1) * 1000);
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const body = await r.json();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
    return body;
  }
  throw new Error(`重試失敗 ${url}`);
}
const wd = (qs) => getJson(`https://www.wikidata.org/w/api.php?format=json&${qs}`, WDCACHE, "wd");
const wp = (qs) => getJson(`https://zh.wikipedia.org/w/api.php?format=json&${qs}`, WDCACHE, "wp");
/** MusicBrainz 不讀快取重抓（刪掉快取檔再呼叫 mb） */
async function mbFresh(path) {
  const url = `https://musicbrainz.org/ws/2/${path}${path.includes("?") ? "&" : "?"}fmt=json`;
  const file = join(root, ".cache", "musicbrainz", `${createHash("sha1").update(url).digest("hex")}.json`);
  if (existsSync(file)) rmSync(file);
  stats.mb++;
  return mb(path);
}
const spotifyIdsOf = (rels) => [
  ...new Set((rels ?? []).map((r) => r.url?.resource?.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})/)?.[1]).filter(Boolean)),
];
const qidOf = (rels) => (rels ?? []).map((r) => r.url?.resource?.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1]).find(Boolean) ?? "";

/* ---------- Spotify search（每秒 ≤1、快取、429 立刻停） ---------- */
let token = "";
let tokenExp = 0;
let spLast = 0;
let spotifyDead = "";
const spStats = { network: 0, cached: 0, r429: 0 };
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
async function sp(path) {
  const url = `https://api.spotify.com/v1/${path}`;
  const file = join(SPCACHE, `${createHash("sha1").update(url).digest("hex")}.json`);
  if (existsSync(file)) {
    spStats.cached++;
    return JSON.parse(readFileSync(file, "utf8")).body;
  }
  if (spotifyDead) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = spLast + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    spLast = Date.now();
    spStats.network++;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(30000) });
    if (r.status === 429) {
      spStats.r429++;
      spotifyDead = `Spotify 429（Retry-After ${r.headers.get("retry-after")} 秒），之後不再打 Spotify`;
      console.error(spotifyDead);
      return null;
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
    mkdirSync(SPCACHE, { recursive: true });
    writeFileSync(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
    return body;
  }
  return null;
}
const normT = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
/** 標題相同：去掉括號段（feat.／Remix／版本）後正規化相等；已知作品是中文時，搜到的標題＝中文＋拉丁字母羅馬拼音（「鎮妹 Zhin' Moi」）也算 */
const sameTitle = (known, got) => {
  const k = normT(known);
  const stripped = String(got ?? "").replace(/\s*[（(\[【].*$/u, "");
  const g = normT(stripped);
  if (k.length < 2) return false;
  if (k === g) return true;
  // 站上打錯一個字（THR／THE）：長度 ≥8 且只差 1 個字元也算
  if (k.length >= 8 && Math.abs(k.length - g.length) <= 1 && editDistance1(k, g)) return true;
  if (hasCJK(known) && g.startsWith(k) && !/[\u3400-\u9fff]/.test(g.slice(k.length))) return true;
  // 站上寫「kamawan za kavung 像帽子一樣」、Spotify 只寫「像帽子一樣」：已知作品去掉前面的羅馬拼音後相等
  if (hasCJK(known) && g.length >= 2 && k.endsWith(g) && !/[\u3400-\u9fff]/.test(k.slice(0, k.length - g.length))) return true;
  return false;
};

/** 兩字串是否只差 1 個字元（取代、插入或刪除） */
function editDistance1(a, b) {
  if (a === b) return true;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return true;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  if (l.length - s.length !== 1) return false;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

/* ---------- 第一輪快取裡的候選資料（不連 Spotify） ---------- */
function spCached(path) {
  const url = `https://api.spotify.com/v1/${path}`;
  const file = join(SPCACHE, `${createHash("sha1").update(url).digest("hex")}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).body : null;
}
/** 候選的照片有無（search artist 的 items 有 images） */
function candImages(names, id) {
  for (const nm of names) {
    const b = spCached(`search?q=${encodeURIComponent(nm)}&type=artist&limit=10&market=TW`);
    const hit = b?.artists?.items?.find((a) => a.id === id);
    if (hit) return (hit.images ?? []).length > 0;
  }
  return null;
}
/** 候選作品（含年份）：第一輪 search album 快取 */
function candAlbums(names, id) {
  const out = [];
  const b = spCached(`search?q=${encodeURIComponent(`artist:${names[0]}`)}&type=album&limit=10&market=TW`);
  for (const al of b?.albums?.items ?? []) if ((al.artists ?? []).some((a) => a.id === id)) out.push({ name: al.name, year: (al.release_date ?? "").slice(0, 4), type: al.album_type });
  return out;
}
const hasCJK = (s) => /[㐀-鿿]/.test(s);
const hasKana = (s) => /[぀-ヿ]/.test(s);
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[\s\-_.'’!&·．,，、()（）]/g, "");

/* ---------- 主程式 ---------- */
const report = JSON.parse(readFileSync(REPORT, "utf8"));
const people = Object.fromEntries(
  query(`SELECT slug, name, aliases, mbid, wiki_url, region, intro FROM artists WHERE kind='藝人' AND status='approved' AND deleted_at IS NULL AND hidden_at IS NULL`).map((p) => [p.slug, p]),
);
const only = opt("--slugs", "") ? opt("--slugs", "").split(",").map((x) => x.trim()).filter(Boolean) : null;
const aliasesOf = (p) => {
  try {
    return JSON.parse(p?.aliases || "[]");
  } catch {
    return [];
  }
};
const doubt = only
  ? only.map((slug) => report.doubt.find((d) => d.slug === slug) ?? { slug, name: people[slug]?.name ?? slug, candidates: [], searched: [people[slug]?.name, ...aliasesOf(people[slug])].filter(Boolean) })
  : report.doubt;
const manualAll = existsSync(MANUAL) ? JSON.parse(readFileSync(MANUAL, "utf8")) : {};
const rejected = manualAll.rejected ?? {};
const seriesBy = new Map();
for (const s of query(`SELECT artist_slug AS a, title, year FROM series WHERE deleted_at IS NULL AND status='approved' ORDER BY year`)) {
  if (!seriesBy.has(s.a)) seriesBy.set(s.a, []);
  seriesBy.get(s.a).push(s);
}
const nomFile = join(root, "..", "研究", "20260927_金曲金音近三屆入圍藝人", "入圍作品_維基.json");
const nominees = existsSync(nomFile) ? JSON.parse(readFileSync(nomFile, "utf8")).藝人 ?? {} : {};
/** 站上已知作品（同第一輪：系列標題、金曲金音入圍作品、維基簡介《》；第一輪報告的 known 只留 8 筆，這裡重算完整的） */
function knownOf(slug) {
  const p = people[slug];
  let intro = "";
  try {
    intro = JSON.parse(p?.intro || "[]").join("\n");
  } catch {}
  return [
    ...new Set([
      ...(seriesBy.get(slug) ?? []).map((x) => x.title),
      ...(nominees[slug]?.works ?? []),
      ...[...intro.matchAll(/《([^》]{1,60})》/g)].map((m) => m[1]),
    ]),
  ];
}
const pendFile = join(WDCACHE, "pending-result.json");
const pendQid = Object.fromEntries((existsSync(pendFile) ? JSON.parse(readFileSync(pendFile, "utf8")).list : []).filter((x) => x.qid).map((x) => [x.slug, x.qid]));

// 跨藝人共用的已知作品（合輯、客串）：不拿去搜
const titleCount = new Map();
for (const d of doubt) for (const k of new Set(people[d.slug] ? knownOf(d.slug) : [])) titleCount.set(k, (titleCount.get(k) ?? 0) + 1);
const shared = new Set([...titleCount].filter(([, c]) => c >= 3).map(([k]) => k));
const cleanTitle = (t) => {
  const x = t.replace(/\s*[（(][^（）()]*(專輯|單曲)[）)]\s*/g, " ").replace(/\s+/g, " ").trim();
  // 入圍作品格式「X (某某專輯) X」去掉括號後變「X X」：只留一個
  const half = x.slice(0, Math.floor(x.length / 2)).trim();
  return half && x === `${half} ${half}` ? half : x;
};

const prevManual = existsSync(MANUAL) ? JSON.parse(readFileSync(MANUAL, "utf8")).artists ?? {} : {};
const adopted = [];
const remain = [];
const shells = [];
let n = 0;
for (const d of doubt) {
  n++;
  const p = people[d.slug];
  if (!p) {
    remain.push({ ...d, note: "正式站已沒有這位藝人" });
    continue;
  }
  // 之前跑過已寫進 spotify-manual.json 的：沿用那次的判定（要重判就把那條刪掉再跑）
  if (prevManual[d.slug]?.spotifyId) {
    const ev = String(prevManual[d.slug].evidence ?? "");
    const type = ev.match(/^第二輪 ([a-z0-9-]+)：/)?.[1] ?? "manual";
    adopted.push({ slug: d.slug, name: d.name, spotifyId: prevManual[d.slug].spotifyId, spotifyName: "", type, evidence: ev.replace(/^第二輪 [a-z0-9-]+：/, "").replace(/（2026-\d\d-\d\d）$/, ""), inCandidates: d.candidates.some((c) => c.id === prevManual[d.slug].spotifyId), fromManual: true });
    console.log(`[${n}/${doubt.length}] ${d.name}：沿用 spotify-manual.json 的指定 ${prevManual[d.slug].spotifyId}`);
    continue;
  }
  const names = d.searched ?? [d.name];
  const known = knownOf(d.slug);
  d.known = known;
  const candIds = new Set(d.candidates.map((c) => c.id));
  const cands = d.candidates.map((c) => ({ ...c, images: candImages(names, c.id), works: candAlbums(names, c.id) }));
  const evidence = { qidFrom: "", qid: "", mbSpotify: [], wdP1902: [], wdSearch: null };
  const take = (id, type, why) => {
    if (rejected[d.slug]?.all || (rejected[d.slug]?.ids ?? []).includes(id)) {
      remain.push({ ...d, note: `規則選到 ${id}，但使用者確認不配` });
      console.log(`[${n}/${doubt.length}] ${d.name}：規則選到 ${id}，使用者確認不配，略過`);
      return;
    }
    const sname = cands.find((c) => c.id === id)?.name ?? "";
    adopted.push({ slug: d.slug, name: d.name, spotifyId: id, spotifyName: sname, type, evidence: why, inCandidates: candIds.has(id) });
    console.log(`[${n}/${doubt.length}] ${d.name}：採用 ${id}（${type}：${why}）`);
  };

  // 2. MusicBrainz url-rels 重查（順便拿 Wikidata QID）
  if (p.mbid) {
    const a = await mbFresh(`artist/${p.mbid}?inc=url-rels`);
    evidence.mbSpotify = spotifyIdsOf(a.relations);
    const q = qidOf(a.relations);
    if (q) Object.assign(evidence, { qid: q, qidFrom: `MusicBrainz ${p.mbid}` });
  }
  // 1. QID 其他來源
  if (!evidence.qid && pendQid[d.slug]) Object.assign(evidence, { qid: pendQid[d.slug], qidFrom: "10/1 補匯 Wikidata 比對" });
  if (!evidence.qid && p.wiki_url) {
    const title = decodeURIComponent((p.wiki_url.match(/\/wiki\/([^?#]+)/) ?? [])[1] ?? "");
    if (title) {
      const r = await wp(`action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&titles=${encodeURIComponent(title)}`);
      const q = Object.values(r?.query?.pages ?? {})[0]?.pageprops?.wikibase_item;
      if (q) Object.assign(evidence, { qid: q, qidFrom: `站上維基條目 ${title}` });
    }
  }
  if (evidence.qid) {
    const r = await wd(`action=wbgetclaims&entity=${evidence.qid}&property=P1902`);
    evidence.wdP1902 = (r?.claims?.P1902 ?? []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
  }
  if (evidence.wdP1902.length) {
    const pick = evidence.wdP1902.find((id) => candIds.has(id)) ?? (evidence.wdP1902.length === 1 ? evidence.wdP1902[0] : "");
    if (pick) {
      take(pick, "wikidata-p1902", `Wikidata ${evidence.qid}（QID 來自${evidence.qidFrom}）的 P1902 Spotify artist ID${candIds.has(pick) ? "，與同名候選一致" : ""}`);
      continue;
    }
  }
  if (evidence.mbSpotify.length === 1) {
    take(evidence.mbSpotify[0], "musicbrainz", `MusicBrainz ${p.mbid} 重查 url-rels，唯一 Spotify 連結${candIds.has(evidence.mbSpotify[0]) ? "，與同名候選一致" : ""}`);
    continue;
  }
  // 2b. Spotify 以作品標題搜尋（系列標題優先，再入圍作品與簡介《》；跨藝人共用的合輯不搜；每位最多 3 次）
  //     每次搜尋的結果（專輯＋曲目）都拿全部已知作品去對，按演出者累計命中的作品數。
  //     採用條件：同一位演出者命中 ≥2 個不同的已知作品（Spotify 名稱可以跟站上不同，像 呂士軒＝TroutFresh、淺堤＝Shallow Levée），
  //     或命中 1 個且演出者名稱＝站上名稱／包含站上名稱
  {
    const titles = [];
    for (const t of known) {
      const c = cleanTitle(t);
      if (!c || shared.has(t) || normT(c).length < 2 || titles.some((x) => normT(x) === normT(c))) continue;
      // 純拉丁且少於 4 個字元的標題（AAA、X）搜出來都是別人的，不浪費次數
      if (!hasCJK(c) && normT(c).length < 4) continue;
      titles.push(c);
    }
    const nameNorms = names.map(norm).filter(Boolean);
    // 完全相同，或演出者名稱包含站上名稱（中文名 ≥2 字、拉丁名 ≥4 字才算包含，避免 Dac 對到 Dacey）
    const artistOk = (a) => nameNorms.some((nm) => norm(a.name) === nm || ((hasCJK(nm) ? nm.length >= 2 : nm.length >= 4) && norm(a.name).includes(nm)));
    // 跨藝人共用的合輯標題不拿去搜，但搜回來的結果對到它也算一個命中（許鈞的《期待集》同時是荒井十一、三隻狗的入圍作品）
    const sharedTitles = [...shared].map(cleanTitle).filter((c) => c && !titles.some((x) => normT(x) === normT(c)));
    const found = new Map(); // spotify artist id → { name, nameOk, hits: Set(已知作品), own: 非合輯命中數, got: [] }
    // 夠強：至少 1 個非合輯作品命中，而且（總命中 ≥2 或名稱相符）
    const strong = () => [...found.values()].filter((v) => v.own >= 1 && (v.hits.size >= 2 || v.nameOk));
    let calls = 0;
    for (const t of titles) {
      // 最多 3 次；已經有一位演出者命中 1 個但名稱不同（像 TroutFresh）時多給 1 次，看能不能湊到第 2 個
      const limit = [...found.values()].some((v) => v.hits.size === 1 && !v.nameOk) ? 4 : 3;
      if (calls >= limit || spotifyDead || strong().length) break;
      const b = await sp(`search?q=${encodeURIComponent(`${t} ${names[0]}`)}&type=album,track&limit=10&market=TW`);
      calls++;
      const items = [...(b?.albums?.items ?? []), ...(b?.tracks?.items ?? [])];
      for (const it of items) {
        const k = titles.find((x) => sameTitle(x, it.name)) ?? sharedTitles.find((x) => sameTitle(x, it.name));
        if (!k) continue;
        const own = titles.includes(k);
        for (const a of it.artists ?? []) {
          const cur = found.get(a.id) ?? { name: a.name, nameOk: artistOk(a), hits: new Set(), own: 0, got: [] };
          if (own && !cur.hits.has(k)) cur.own++;
          cur.hits.add(k);
          if (!cur.got.includes(it.name)) cur.got.push(it.name);
          found.set(a.id, cur);
        }
      }
    }
    evidence.titleSearch = [...found].map(([id, v]) => ({ id, name: v.name, nameOk: v.nameOk, hits: [...v.hits] }));
    let st = strong();
    // 多位都夠強（合作曲兩位演出者都命中）：名稱相符的那位優先
    if (st.length > 1 && st.filter((v) => v.nameOk).length === 1) st = st.filter((v) => v.nameOk);
    if (st.length === 1) {
      const id = [...found].find(([, v]) => v === st[0])[0];
      const v = st[0];
      take(
        id,
        "search-title",
        `用站上作品搜 Spotify，演出者「${v.name}」${v.nameOk ? "（名稱相符）" : "（Spotify 名稱跟站上不同）"}有 ${v.hits.size} 個同名作品：${[...v.hits].slice(0, 3).join("、")}${candIds.has(id) ? "（＝第一輪同名候選）" : "（第一輪搜尋沒抓到這位）"}`,
      );
      continue;
    }
    if (st.length > 1) evidence.note = `作品標題搜尋對到 ${st.length} 位演出者，不採用`;
  }
  // 3 前置：候選都還沒抓到作品的（站上沒有已知作品的第一輪根本沒搜；有的只用全名搜過一次），用拆開的名字再搜 artist:名（最多 3 個名字）
  if (cands.length && !cands.some((c) => c.works.length)) {
    for (const nm of names.slice(0, 3)) {
      if (spotifyDead) break;
      const b = await sp(`search?q=${encodeURIComponent(`artist:${nm}`)}&type=album&limit=10&market=TW`);
      for (const c of cands) for (const al of b?.albums?.items ?? []) if ((al.artists ?? []).some((a) => a.id === c.id) && !c.works.some((w) => w.name === al.name)) c.works.push({ name: al.name, year: (al.release_date ?? "").slice(0, 4), type: al.album_type });
      if (cands.some((c) => c.works.length)) break;
    }
  }
  // 1b. Wikidata 同名項目的 P1902 正好是候選之一
  if (!evidence.qid) {
    // 只認站上主名稱與拆出來的中文段（純拉丁別名像「The Wanted」會對到同名的外國團）
    const wanted = new Set([d.name, ...names.filter(hasCJK)].map(norm));
    const found = [];
    for (const nm of [...new Set([d.name, ...names.filter(hasCJK)])].slice(0, 2)) {
      const s = await wd(`action=wbsearchentities&search=${encodeURIComponent(nm)}&language=zh&uselang=zh-tw&type=item&limit=7`);
      for (const x of s?.search ?? []) if (!found.some((f) => f.id === x.id)) found.push(x);
    }
    if (found.length) {
      const ents = await wd(`action=wbgetentities&ids=${found.map((x) => x.id).join("|")}&props=labels|aliases|claims|descriptions&languages=zh-tw|zh-hant|zh|en`);
      const hits = [];
      for (const [id, e] of Object.entries(ents?.entities ?? {})) {
        const labels = [...Object.values(e.labels ?? {}).map((v) => v.value), ...Object.values(e.aliases ?? {}).flat().map((v) => v.value)];
        if (!labels.some((l) => wanted.has(norm(l)))) continue;
        const sp = (e.claims?.P1902 ?? []).map((c) => c.mainsnak?.datavalue?.value).filter((v) => candIds.has(v));
        if (sp.length) hits.push({ qid: id, label: labels[0], desc: e.descriptions?.["zh-tw"]?.value ?? e.descriptions?.zh?.value ?? e.descriptions?.en?.value ?? "", ids: sp });
      }
      evidence.wdSearch = hits;
      if (hits.length === 1 && new Set(hits[0].ids).size === 1) {
        take(hits[0].ids[0], "wikidata-search", `Wikidata 同名項目 ${hits[0].qid}「${hits[0].label}」（${hits[0].desc || "無描述"}）的 P1902 正好是同名候選`);
        continue;
      }
    }
  }
  // 3. 單一候選、名稱有中文（非日文）、站上沒有已知作品、候選有作品
  const cjkName = hasCJK(d.name) && !hasKana(d.name);
  //    候選本身要像華語圈的藝人：Spotify 名稱含中文，或作品標題有中文（純英文名＋純英文作品的「AAA」「Roger Lin」會對到外國人，不採用）
  const cjkCand = (c) => (hasCJK(c.name) && !hasKana(c.name)) || c.works.some((w) => hasCJK(w.name) && !hasKana(w.name));
  // 3a. 單一候選，候選作品（這次補搜的）跟站上已知作品相同 → 採用
  if (cands.length === 1) {
    const hit = cands[0].works.find((w) => known.some((k) => !shared.has(k) && sameTitle(cleanTitle(k), w.name)));
    if (hit) {
      take(cands[0].id, "single-works-hit", `唯一同名候選，Spotify 作品「${hit.name}」跟站上已知作品相同`);
      continue;
    }
  }
  // 站上已知作品只有跨藝人共用的合輯（不完全自救手冊這種）＝沒有可比的，照「站上沒有已知作品」處理
  const knownReal = known.filter((k) => !shared.has(k));
  if (cands.length === 1 && cjkName && !knownReal.length && cands[0].works.length && cjkCand(cands[0])) {
    take(cands[0].id, "single-cjk-empty", `唯一同名候選、名稱含中文、站上${known.length ? "只有跨藝人合輯、" : ""}沒有已知作品可比、候選在 Spotify 有 ${cands[0].works.length} 張作品（${cands[0].works.slice(0, 2).map((w) => w.name).join("、")}）${hasCJK(cands[0].name) ? "" : "、作品標題有中文"}`);
    continue;
  }
  // 4. 多位候選：只有一位有作品且有照片，其他沒作品也沒照片
  //    放寬：只有一位有作品，而且那位的作品有中文標題或跟站上已知作品對得上（其他位有沒有照片不管）
  if (cands.length > 1) {
    const real = cands.filter((c) => c.works.length && c.images);
    const shells = cands.filter((c) => !c.works.length && !c.images);
    if (real.length === 1 && shells.length === cands.length - 1) {
      take(real[0].id, "multi-only-real", `${cands.length} 位同名候選只有這位有作品（${real[0].works.slice(0, 2).map((w) => w.name).join("、")}）又有照片，其他 ${shells.length} 位沒作品沒照片`);
      continue;
    }
    const withWorks = cands.filter((c) => c.works.length);
    if (withWorks.length === 1) {
      const c = withWorks[0];
      const hit = c.works.find((w) => known.some((k) => sameTitle(cleanTitle(k), w.name)));
      if (hit || cjkCand(c)) {
        take(c.id, "multi-only-real", `${cands.length} 位同名候選只有這位有作品（${c.works.slice(0, 2).map((w) => w.name).join("、")}）${hit ? `，其中「${hit.name}」跟站上作品相同` : "，作品有中文標題"}`);
        continue;
      }
    }
  }
  // 空殼：所有候選都沒照片也沒作品、作品標題搜尋也沒對到任何演出者 → 當找不到，不配、也不用使用者看
  if (cands.every((c) => !c.images && !c.works.length) && !(evidence.titleSearch ?? []).length) {
    shells.push({ slug: d.slug, name: d.name, candidates: cands.map((c) => c.url) });
    console.log(`[${n}/${doubt.length}] ${d.name}：空殼候選，不配`);
    continue;
  }
  remain.push({ ...d, candidates: cands, evidence });
}

const out = {
  產生時間: new Date().toISOString(),
  統計: {
    疑義: doubt.length,
    採用: adopted.length,
    採用來源: adopted.reduce((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {}),
    空殼不配: shells.length,
    仍待使用者: remain.length,
    外部請求: { ...stats, spotify: spStats, spotifyStopped: spotifyDead || null },
    說明: "Spotify 回應沒有 genres／followers／popularity 欄位，規格第 3 條的 genres 分支用不上",
  },
  adopted,
  shells,
  remain,
};
console.log(`\n採用 ${adopted.length}（${JSON.stringify(out.統計.採用來源)}）、空殼不配 ${shells.length}、仍待使用者 ${remain.length}；請求 ${JSON.stringify(out.統計.外部請求)}`);
if (only) {
  writeFileSync(join(OUTDIR, "顯示中補對.json"), JSON.stringify(out, null, 1) + "\n");
  if (write) {
    const manual = JSON.parse(readFileSync(MANUAL, "utf8"));
    for (const a of adopted) if (!a.fromManual) manual.artists[a.slug] = { spotifyId: a.spotifyId, evidence: `顯示中補對 ${a.type}：${a.evidence}（2026-10-03）` };
    writeFileSync(MANUAL, JSON.stringify(manual, null, 1) + "\n");
  }
  process.exit(0);
}
if (!write) {
  writeFileSync(join(OUTDIR, "第二輪判定_試跑.json"), JSON.stringify(out, null, 1) + "\n");
  process.exit(0);
}
writeFileSync(join(OUTDIR, "第二輪判定.json"), JSON.stringify(out, null, 1) + "\n");

// spotify-manual.json（保留既有的手動指定）
const manual = existsSync(MANUAL) ? JSON.parse(readFileSync(MANUAL, "utf8")) : { _說明: "藝人識別碼 → 手動指定的 Spotify 藝人 ID（優先於 spotify-match.mjs 的自動規則；只有公開 ID）", artists: {} };
for (const a of adopted) manual.artists[a.slug] = { spotifyId: a.spotifyId, evidence: `第二輪 ${a.type}：${a.evidence}（2026-10-03）` };
writeFileSync(MANUAL, JSON.stringify(manual, null, 1) + "\n");

// 精簡版清單
const lines = [];
lines.push(`# Spotify 待確認 精簡版（2026-10-03）`, "");
lines.push(
  `第一輪疑義 98 位，第二輪用 Wikidata P1902、MusicBrainz 重查、單一中文候選等證據自動採用 ${adopted.length} 位（名單與證據在 \`第二輪判定.json\`），剩下 ${remain.length} 位要請你看。每位最多列 3 個候選，點 Spotify 連結看頭像與作品，對得上就回「第 N 位＝候選 A」，都不是就回「第 N 位＝都不是」，不回的維持不配。`,
  "",
);
lines.push(`| # | 藝人 | 站上已知作品 | 候選 | Spotify | 候選的作品 |`, `|---|---|---|---|---|---|`);
let i = 0;
for (const d of remain) {
  i++;
  const site = [...(seriesBy.get(d.slug) ?? []).map((s) => `${s.title}${s.year ? `（${s.year}）` : ""}`), ...(d.known ?? [])];
  const siteTxt = [...new Set(site)].slice(0, 2).join("、") || "（無）";
  // 作品標題搜尋對到、但名稱跟站上不同的演出者（TroutFresh 那種）也列進候選，給使用者判斷
  const extra = (d.evidence?.titleSearch ?? [])
    .filter((t) => !d.candidates.some((c) => c.id === t.id))
    .map((t) => ({ id: t.id, name: t.name, url: `https://open.spotify.com/artist/${t.id}`, images: true, works: t.hits.map((h) => ({ name: `${h}（跟站上作品同名）`, year: "" })) }));
  const cs = [...d.candidates, ...extra].slice(0, 3);
  cs.forEach((c, k) => {
    const works = c.works.slice(0, 2).map((w) => `${w.name}${w.year ? `（${w.year}）` : ""}`).join("、") || "（搜尋沒抓到）";
    const tag = String.fromCharCode(65 + k);
    lines.push(`| ${k === 0 ? i : ""} | ${k === 0 ? d.name : ""} | ${k === 0 ? siteTxt : ""} | ${tag}. ${c.name}${c.images ? "" : "（無頭像）"} | [開](${c.url}) | ${works} |`);
  });
  if (d.candidates.length + extra.length > 3) lines.push(`| | | | 另有 ${d.candidates.length + extra.length - 3} 位同名候選未列 | | |`);
}
lines.push("", `## 空殼候選，已自動不配（${shells.length} 位）`, "", `Spotify 上同名的頁面沒有頭像也沒有任何作品，作品搜尋也對不到：就算是本人，嵌入播放器也沒東西可放。先當找不到，之後有作品上架再補。`, "");
for (const x of shells) lines.push(`- ${x.name}：${x.candidates.map((u, k) => `[候選 ${k + 1}](${u})`).join("、")}`);
lines.push("", `找不到 45 位維持不配（名單見 \`待確認清單.md\` 最後一段）。`);
writeFileSync(join(OUTDIR, "用戶確認_精簡版.md"), lines.join("\n") + "\n");
console.log(`已寫 ${MANUAL}、${join(OUTDIR, "用戶確認_精簡版.md")}`);
