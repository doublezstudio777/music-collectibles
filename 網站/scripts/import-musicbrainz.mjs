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
const persist = opt("--persist-to", ".wrangler/state");
const dry = argv.includes("--dry-run");
/** 用戶本人收藏（正式站第 3 則）掛的版本：整列不碰 */
const PROTECTED_SHARE = 3;

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

const people = artistRows.map((r) => {
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
for (const p of people) p.peers = people.filter((x) => x !== p).flatMap((x) => [x.name, ...x.en]);

console.log(`== 藝人對應（${people.length} 位） ==`);
const mapping = [];
for (const p of people) {
  const m = await matchArtist(p);
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
writeFileSync(join(CACHE, "mapping.json"), JSON.stringify(mapping, null, 2));
console.log(`MusicBrainz 請求：網路 ${stats.network}、快取 ${stats.cached}、重試 ${stats.retries}`);
if (fetchOnly) process.exit(0);

// 以下在 --local／--remote 時執行（資料庫部分另見本檔後半）
await import("./import-musicbrainz-db.mjs").then((m) => m.run({ argv, remote, persist, dry, mapping, releases, people, releaseRows, PROTECTED_SHARE, mb, norm, titleHit }));
