// MusicBrainz 一次匯入（2026-09-28 定案 A）：顏社、本色音樂 24 位藝人的實體發行與各版本曲目。
// 本機跑，不是 Worker。之後不自動同步。
//
// 用法（在 網站/ 底下）：
//   node scripts/import-musicbrainz.mjs --fetch-only                 只抓 MusicBrainz、做藝人對應（寫快取與 .cache/musicbrainz/mapping.json）
//   node scripts/import-musicbrainz.mjs --local  [--persist-to <資料夾>] [--dry-run]
//   node scripts/import-musicbrainz.mjs --remote [--dry-run]          正式環境：先跑 scripts/backup.mjs --remote，失敗就不匯入
// 產出：.wrangler/import-musicbrainz.sql（實際執行的 SQL）、.wrangler/import-musicbrainz-report.json
//
// 對應：release-group → 系列（kind：album｜ep｜single）；release 的實體 format → 品項；每個 release → 版本。
// 只收實體（CD、黑膠各尺寸、卡帶、DVD、Blu-ray…），Digital Media 一律不收。
// 去重：既有系列用「藝人＋標題＋年份」比對（研究匯入的 47 筆與會員建的都算）；既有版本用「品項＋年份」比對，
//       對上的只補空白欄位，不覆蓋已有值。用戶本人第 3 則收藏掛的版本整列不碰。
// 每一筆寫入的都標 source='musicbrainz' 與 MBID；可重跑，MBID 已存在就不再建。
//
// 金曲金音批（2026-09-29）：加 --set awards，對象改成 研究/20260927_金曲金音近三屆入圍藝人/藝人名單_v2.csv 裡
//   類型與地區都確定（＝當初 import-artists.mjs 匯進站的那 216 位）、且不在顏社本色 24 位裡的藝人；已知作品取維基簡介裡《》括起來的
//   加上 入圍作品_維基.json（各屆入圍表格同列的作品名），
//   另用 Wikidata＝中文維基條目佐證（見 musicbrainz-fetch.mjs 3c）。顏社本色 24 位不重抓，只沿用上次的對應結果
//   （.cache/musicbrainz/mapping.json）讓共同署名的發行歸到對的人、既有系列比得到。對應結果寫 mapping-awards.json。
//   node scripts/import-musicbrainz.mjs --set awards --fetch-only｜--local｜--remote
//
// 手動設定（2026-09-28 MusicBrainz 後續）：scripts/musicbrainz-manual.json（或 --manual <檔>）
//   artists：{ 識別碼: { mbid, evidence } }，自動規則擋下但人工確認是本人的藝人，直接指定 MBID；
//            也可用參數 --mbid 識別碼=MBID（可重複，evidence 寫「參數指定」）。指定的 MBID 會先向 MusicBrainz 查一次確認存在
//   protectedShare.fillBlank：第 3 則收藏掛的版本，只補這幾個「原本空白」的欄位，其他欄位（含 mbid）照舊不碰
//   mergeSeries：[{ from, into, title }]，同一作品被拆成兩個系列時併成一個（見 import-musicbrainz-db.mjs 的 mergeSeries）

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE, matchArtist, mb, norm, releasesOf, stats, titleHit } from "./musicbrainz-fetch.mjs";

const argv = process.argv.slice(2);
const fetchOnly = argv.includes("--fetch-only");
const remote = argv.includes("--remote");
if (!fetchOnly && remote === argv.includes("--local")) {
  console.error("要指定 --remote（正式）、--local（本機）或 --fetch-only");
  process.exit(2);
}
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const research = join(root, "..", "研究", "20260927_顏社本色音樂");
const set = opt("--set", "label");
if (!["label", "awards", "pending"].includes(set)) {
  console.error("--set 只能是 label（顏社本色，預設）、awards（金曲金音）或 pending（補匯的 109 位＋上次對不到的重查）");
  process.exit(2);
}
const persist = opt("--persist-to", ".wrangler/state");
const dry = argv.includes("--dry-run");
/** 用戶本人收藏（正式站第 3 則）掛的版本：整列不碰 */
const PROTECTED_SHARE = 3;
const manualFile = opt("--manual", join(root, "scripts", "musicbrainz-manual.json"));
const manual = JSON.parse(readFileSync(manualFile, "utf8"));
manual.artists ??= {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== "--mbid") continue;
  const [slug, mbid] = String(argv[i + 1] ?? "").split("=");
  if (!slug || !/^[0-9a-f-]{36}$/.test(mbid ?? "")) {
    console.error(`--mbid 格式是 識別碼=MBID：${argv[i + 1]}`);
    process.exit(2);
  }
  manual.artists[slug] = { mbid, evidence: "參數指定" };
}

/* ---------- CSV ---------- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const artistRows = parseCsv(readFileSync(join(research, "藝人.csv"), "utf8"));
const releaseRows = parseCsv(readFileSync(join(research, "實體發行.csv"), "utf8"));
const GENDER = { 男歌手: "male", 女歌手: "female", 團體: "group" };

/* ---------- 1. 藝人對應＋抓發行（網路，有快取） ---------- */

const labelPeople = artistRows.map((r) => {
  const known = [
    ...releaseRows.filter((x) => x["藝人網址識別碼"] === r["網址識別碼"]).map((x) => x["系列名稱"].replace(/（再版）$/, "")),
    ...[...(r["簡介"] ?? "").matchAll(/《([^》]+)》/g)].map((m) => m[1]),
  ];
  return {
    slug: r["網址識別碼"],
    name: r["藝人中文名"],
    en: (r["藝人英文名"] ?? "").split("/").map((x) => x.trim()).filter(Boolean),
    gender: GENDER[r["類型"]] ?? null,
    label: r["廠牌"],
    known: [...new Set(known)],
  };
});

/** 金曲金音批的對象（見開頭說明） */
function awardsPeople() {
  const dir = join(root, "..", "研究", "20260927_金曲金音近三屆入圍藝人");
  const rows = parseCsv(readFileSync(join(dir, "藝人名單_v2.csv"), "utf8"));
  const wiki = new Map(
    parseCsv(readFileSync(join(dir, "維基簡介.csv"), "utf8"))
      .filter((w) => w["狀態"] === "已取得" && w["維基條目網址"])
      .map((w) => [w["藝人中文名"], w]),
  );
  const labelSlugs = new Set(labelPeople.map((p) => p.slug));
  // 入圍作品（中文維基各屆條目的入圍表格擷取，只當對應佐證）
  const works = JSON.parse(readFileSync(join(dir, "入圍作品_維基.json"), "utf8")).藝人;
  const REGION = { 國內: "domestic", 國外: "overseas" };
  return rows
    .filter((r) => r["類型"] !== "待確認" && r["地區"] !== "待確認" && !labelSlugs.has(r["網址識別碼"]))
    .map((r) => {
      const w = wiki.get(r["藝人中文名"]);
      return {
        slug: r["網址識別碼"],
        name: r["藝人中文名"],
        en: (r["藝人英文名"] ?? "").split("/").map((x) => x.trim()).filter(Boolean),
        gender: GENDER[r["類型"]] ?? null,
        region: REGION[r["地區"]] ?? null,
        label: "金曲金音",
        wiki: w?.["維基條目網址"] ?? "",
        known: [...new Set([...[...(w?.["簡介"] ?? "").matchAll(/《([^》]+)》/g)].map((m) => m[1]), ...(works[r["網址識別碼"]]?.works ?? [])])],
      };
    });
}
/**
 * 補匯批（2026-10-01，自動補資料第 3 層）：
 *   - 金曲金音類型或地區待確認的 109 位（import-pending-artists.mjs 匯進站的；併進既有藝人的那幾位不算，既有那位若上次沒對上會在下一組）
 *   - 金曲金音批上次（mapping-awards.json）沒對上的藝人重查
 * 兩組都把名字拆開當別名一起搜：中英連寫（JOLIN蔡依林 → JOLIN、蔡依林）、「／」分隔。對應規則不變，一樣要作品、維基或團員佐證才算對上。
 * 類型地區：109 位用 Wikidata 補的結果（沒有就不限），上次那組用名單的值
 */
async function pendingPeople() {
  const { pendingRows, splitNames } = await import("./wikidata-pending.mjs");
  const dir = join(root, "..", "研究", "20260927_金曲金音近三屆入圍藝人");
  const wiki = new Map(
    parseCsv(readFileSync(join(dir, "維基簡介.csv"), "utf8"))
      .filter((w) => w["狀態"] === "已取得" && w["維基條目網址"])
      .map((w) => [w["藝人中文名"], w]),
  );
  const works = JSON.parse(readFileSync(join(dir, "入圍作品_維基.json"), "utf8")).藝人;
  const REGION = { 國內: "domestic", 國外: "overseas" };
  const wd = JSON.parse(readFileSync(join(root, ".cache", "wikidata", "pending-result.json"), "utf8"));
  const wdBySlug = new Map(wd.list.map((x) => [x.slug, x]));
  const merged = new Set(JSON.parse(readFileSync(join(root, ".wrangler", "import-pending-report.json"), "utf8")).明細.併進既有.map((x) => x.slug));
  const one = (r, gender, region) => {
    const w = wiki.get(r["藝人中文名"]);
    return {
      slug: r["網址識別碼"],
      name: r["藝人中文名"],
      en: splitNames(r["藝人中文名"], r["藝人英文名"]).filter((n) => n !== r["藝人中文名"]),
      gender,
      region,
      label: "金曲金音",
      wiki: w?.["維基條目網址"] ?? "",
      known: [...new Set([...[...(w?.["簡介"] ?? "").matchAll(/《([^》]+)》/g)].map((m) => m[1]), ...(works[r["網址識別碼"]]?.works ?? [])])],
    };
  };
  const pend = pendingRows()
    .filter((r) => !merged.has(r["網址識別碼"]))
    .map((r) => {
      const x = wdBySlug.get(r["網址識別碼"]);
      const ok = x?.status === "成功";
      return one(r, GENDER[r["類型"]] ?? (ok ? x.gender : null) ?? null, REGION[r["地區"]] ?? (ok ? x.region : null) ?? null);
    });
  const prev = JSON.parse(readFileSync(join(CACHE, "mapping-awards.json"), "utf8"));
  const missed = new Set(prev.filter((m) => m.status !== "ok").map((m) => m.slug));
  const rows = parseCsv(readFileSync(join(dir, "藝人名單_v2.csv"), "utf8"));
  const again = rows.filter((r) => missed.has(r["網址識別碼"])).map((r) => one(r, GENDER[r["類型"]] ?? null, REGION[r["地區"]] ?? null));
  return [...pend, ...again];
}
const people = set === "pending" ? await pendingPeople() : set === "awards" ? awardsPeople() : labelPeople;
const allNames = [...labelPeople, ...people].flatMap((x) => [x.name, ...x.en]);
for (const p of people) p.peers = allNames.filter((n) => n !== p.name && !p.en.includes(n));

console.log(`== 藝人對應（${people.length} 位） ==`);
const mapping = [];
for (const p of people) {
  let m = await matchArtist(p);
  const pin = manual.artists[p.slug];
  if (pin) {
    // 手動指定：先確認 MBID 在 MusicBrainz 上真的存在（查不到會丟錯停下），自動對應的候選照樣留在報告裡
    const a = await mb(`artist/${pin.mbid}`);
    m = { status: "ok", mbid: pin.mbid, manual: true, candidates: m.candidates, reason: `手動指定「${a.name}」（${a.country ?? "國家未標"}｜${a.type ?? "類型未標"}）：${pin.evidence}；自動規則原判：${m.reason}` };
  }
  mapping.push({ slug: p.slug, name: p.name, label: p.label, ...m });
  console.log(`  ${m.status === "ok" ? "✓" : "✗"} ${p.name}（${p.slug}）${m.mbid ?? ""}：${m.reason}`);
}
const matched = mapping.filter((m) => m.status === "ok");
const releases = new Map(); // mbid → release[]
for (const m of matched) {
  const list = await releasesOf(m.mbid);
  releases.set(m.mbid, list);
  console.log(`  ${m.name}：${list.length} 個 release`);
}
mkdirSync(CACHE, { recursive: true });
writeFileSync(join(CACHE, set === "pending" ? "mapping-pending.json" : set === "awards" ? "mapping-awards.json" : "mapping.json"), JSON.stringify(mapping, null, 2));
console.log(`MusicBrainz 請求：網路 ${stats.network}、快取 ${stats.cached}、重試 ${stats.retries}`);
if (fetchOnly) process.exit(0);

// 金曲金音批：顏社本色 24 位沿用上次的對應（不抓發行），只用來歸屬共同署名、比對既有系列
let dbMapping = mapping;
let dbPeople = people;
if (set === "awards") {
  const prev = JSON.parse(readFileSync(join(CACHE, "mapping.json"), "utf8"));
  dbMapping = [...mapping, ...prev.filter((m) => m.status === "ok").map((m) => ({ ...m, previous: true }))];
  dbPeople = [...people, ...labelPeople];
}
if (set === "pending") {
  // 顏社本色、金曲金音上次對上的沿用（不抓發行），只用來歸屬共同署名、比對既有系列
  const prev = [...JSON.parse(readFileSync(join(CACHE, "mapping.json"), "utf8")), ...JSON.parse(readFileSync(join(CACHE, "mapping-awards.json"), "utf8"))];
  const mine = new Set(mapping.map((m) => m.slug));
  dbMapping = [...mapping, ...prev.filter((m) => m.status === "ok" && !mine.has(m.slug)).map((m) => ({ ...m, previous: true }))];
  dbPeople = [...people, ...labelPeople, ...awardsPeople()];
}
// 以下在 --local／--remote 時執行（資料庫部分另見本檔後半）
await import("./import-musicbrainz-db.mjs").then((m) =>
  m.run({ argv, remote, persist, dry, mapping: dbMapping, releases, people: dbPeople, releaseRows, PROTECTED_SHARE, manual, mb, norm, titleHit, set }),
);
