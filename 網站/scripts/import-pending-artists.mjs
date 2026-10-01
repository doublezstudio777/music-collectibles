// 金曲金音「類型或地區待確認」的 109 位補匯入（2026-10-01，自動補資料第 3 層）。
//
// 前一步：node scripts/wikidata-pending.mjs（Wikidata 補類型與地區，結果在 .cache/wikidata/pending-result.json）
// 規則：
//   - 類型、地區：研究名單有值就用名單；名單是「待確認」就用 Wikidata「成功」那筆；都沒有就留空照樣匯入
//     （留空的不出現在 /artists 的男歌手／女歌手／團體篩選，也不算國內國外）
//   - 簡介、獎項、出處照 import-artists.mjs 同一套（維基簡介 CC BY-SA 4.0、獎項取名單的入圍與得獎紀錄）
//   - 別名：中英連寫的名字拆開的兩半（Acid Brain酸腦 → Acid Brain、酸腦）、「／」分隔的另一個名字，方便搜尋
//   - 跟站上既有藝人同一人（名字或拆開的一半跟既有藝人的名字、別名完全相同，例：ERIKA劉艾立＝劉艾立）：不另建，
//     只把這次的名字補成既有藝人的別名、獎項補上既有藝人沒有的那幾條，列在報告「併進既有」
//   - 顯示規則照舊（display＝auto：有系列、或有獎項＋維基簡介才顯示）
// 可重跑：每一句都是「沒有才建」「只補不蓋」。
//
// 用法（在 網站/ 底下）：
//   node scripts/import-pending-artists.mjs --local [--persist-to <資料夾>] [--dry-run]
//   node scripts/import-pending-artists.mjs --remote [--dry-run]    正式環境：先跑 scripts/backup.mjs --remote，失敗就不匯入
// 產出：.wrangler/import-pending-artists.sql、.wrangler/import-pending-report.json

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pendingRows, splitNames } from "./wikidata-pending.mjs";

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("要指定 --remote（正式）或 --local（本機）其中一個");
  process.exit(2);
}
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const research = join(root, "..", "研究");
const persist = opt("--persist-to", ".wrangler/state");
const dry = argv.includes("--dry-run");

const wrangler = (args, capture = false) =>
  spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], {
    cwd: root,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const target = remote ? ["--remote", "--config", "wrangler.production.jsonc"] : ["--local", "--config", "wrangler.local.jsonc", "--persist-to", persist];
function query(sql) {
  const r = wrangler(["d1", "execute", "DB", ...target, "--json", "--command", sql], true);
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`查詢失敗：${sql}`);
  }
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0].results;
}

/* ---------- 跟 import-artists.mjs 同一套的對照 ---------- */
const GENDER = { 男歌手: "male", 女歌手: "female", 團體: "group" };
const REGION = { 國內: "domestic", 國外: "overseas" };
const WIKI_LICENSE = "CC BY-SA 4.0";
const FETCHED = "2026-09-27";
function parseAwards(nominated, won) {
  const wonSet = new Set(won.split("；").map((x) => x.trim()).filter(Boolean));
  return nominated
    .split("；")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = x.match(/^(第\d+屆)\s*(金曲獎|金音創作獎|金音)\s*(.+)$/);
      return { year: m ? m[1] : "", award: m ? (m[2] === "金音" ? "金音創作獎" : m[2]) : x, category: m ? m[3].trim() : "", result: wonSet.has(x) ? "得獎" : "入圍" };
    });
}
const awardLine = (awards) => {
  const top = awards.find((a) => a.result === "得獎") ?? awards[0];
  return top ? `${top.year}${top.award} ${top.category}${top.result === "得獎" ? "得主" : "入圍"}` : "";
};
const paras = (t) => t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

/* ---------- 讀來源 ---------- */
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
const wikiByName = new Map(
  parseCsv(readFileSync(join(research, "20260927_金曲金音近三屆入圍藝人", "維基簡介.csv"), "utf8"))
    .filter((w) => w["狀態"] === "已取得" && w["簡介"] && w["維基條目網址"])
    .map((w) => [w["藝人中文名"], w]),
);
const wd = JSON.parse(readFileSync(join(root, ".cache", "wikidata", "pending-result.json"), "utf8"));
const wdBySlug = new Map(wd.list.map((x) => [x.slug, x]));
const rows = pendingRows();

/* ---------- 目前站上 ---------- */
const site = query(`SELECT slug, name, aliases, awards, deleted_at AS del FROM artists`);
const redirects = new Map(query(`SELECT old_slug AS o, new_slug AS n FROM artist_redirects`).map((r) => [r.o, r.n]));
const bySlug = new Map(site.map((a) => [a.slug, a]));
const byName = new Map();
for (const a of site.filter((x) => !x.del)) for (const n of [a.name, ...JSON.parse(a.aliases || "[]")]) if (norm(n)) byName.set(norm(n), a);

/* ---------- 產生 SQL ---------- */
const lines = [];
const report = { 名單: rows.length, 新建: [], 已存在略過: [], 併進既有: [], 類型: { 名單: 0, Wikidata: 0, 留空: 0 }, 地區: { 名單: 0, Wikidata: 0, 留空: 0 }, 帶維基簡介: 0 };
for (const r of rows) {
  const slug = r["網址識別碼"];
  const name = r["藝人中文名"];
  const w = wdBySlug.get(slug);
  const ok = w?.status === "成功";
  const gender = GENDER[r["類型"]] ?? (ok ? w.gender : null) ?? null;
  const region = REGION[r["地區"]] ?? (ok ? w.region : null) ?? null;
  const gFrom = GENDER[r["類型"]] ? "名單" : ok && w.gender ? "Wikidata" : "留空";
  const rFrom = REGION[r["地區"]] ? "名單" : ok && w.region ? "Wikidata" : "留空";
  const awards = parseAwards(r["入圍紀錄"], r["得獎紀錄"]);
  // 研究填的維基條目不是本人的（例：林以樂填的是雀斑樂團）就不帶簡介
  const wiki = w?.reason?.includes("不是本人的條目") ? undefined : wikiByName.get(name);
  const split = splitNames(name, r["藝人英文名"]).filter((n) => norm(n) !== norm(name));
  const row = { slug, name, 類型: gender, 類型來源: gFrom, 地區: region, 地區來源: rFrom, wikidata: w?.status ?? "沒跑", qid: ok ? w.qid : undefined };

  if (redirects.has(slug) || bySlug.has(slug)) {
    report.已存在略過.push(row);
    continue;
  }
  // 同一人已在站上：名字或拆開的一半跟既有藝人的名字、別名完全相同
  const same = [name, ...split].map((n) => byName.get(norm(n))).find(Boolean);
  if (same) {
    const have = JSON.parse(same.awards || "[]");
    const add = awards.filter((x) => !have.some((h) => h.year === x.year && h.award === x.award && h.category === x.category));
    const aliases = JSON.parse(same.aliases || "[]");
    const newAlias = [name, ...split].filter((n) => norm(n) !== norm(same.name) && !aliases.some((x) => norm(x) === norm(n)));
    if (newAlias.length) lines.push(`UPDATE artists SET aliases = ${q(JSON.stringify([...aliases, ...newAlias]))} WHERE slug = ${q(same.slug)} AND aliases = ${q(same.aliases)};`);
    if (add.length) lines.push(`UPDATE artists SET awards = ${q(JSON.stringify([...have, ...add]))} WHERE slug = ${q(same.slug)} AND awards = ${q(same.awards)};`);
    report.併進既有.push({ ...row, 併進: `${same.name}（${same.slug}）`, 補別名: newAlias, 補獎項: add.length });
    continue;
  }
  if (gFrom !== "留空") report.類型[gFrom]++;
  else report.類型.留空++;
  if (rFrom !== "留空") report.地區[rFrom]++;
  else report.地區.留空++;
  if (wiki) report.帶維基簡介++;
  report.新建.push(row);
  lines.push(
    `INSERT INTO artists (slug, name, aliases, kind, gender, region, tagline, intro, awards, wiki_url, wiki_license, wiki_fetched_at, source, status, display) SELECT ${[
      slug,
      name,
      JSON.stringify(split),
      "藝人",
      gender,
      region,
      awardLine(awards),
      JSON.stringify(wiki ? paras(wiki["簡介"]) : []),
      JSON.stringify(awards),
      wiki?.["維基條目網址"] ?? null,
      wiki ? WIKI_LICENSE : null,
      wiki ? FETCHED : null,
      `金曲金音近三屆入圍名單：${r["來源網址"]}${ok ? `；類型地區：Wikidata ${w.qid}` : ""}`,
      "approved",
      "auto",
    ]
      .map(q)
      .join(", ")} WHERE NOT EXISTS (SELECT 1 FROM artists WHERE slug = ${q(slug)}) AND NOT EXISTS (SELECT 1 FROM artist_redirects WHERE old_slug = ${q(slug)});`,
  );
}

const out = join(root, ".wrangler", "import-pending-artists.sql");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
const summary = {
  環境: remote ? "remote" : "local",
  名單: report.名單,
  新建: report.新建.length,
  已存在略過: report.已存在略過.length,
  併進既有: report.併進既有.length,
  類型: report.類型,
  地區: report.地區,
  帶維基簡介: report.帶維基簡介,
  明細: report,
};
writeFileSync(join(root, ".wrangler", "import-pending-report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, 明細: undefined }, null, 2));
if (dry) {
  console.log(`--dry-run：SQL 寫在 ${out}，沒有執行`);
  process.exit(0);
}
if (!lines.length) process.exit(0);
if (remote) {
  console.log("\n== 匯入前先備份正式站 ==");
  const b = spawnSync(process.execPath, ["scripts/backup.mjs", "--remote"], { cwd: root, stdio: "inherit" });
  if (b.status !== 0) {
    console.error("備份失敗，停止匯入");
    process.exit(1);
  }
}
console.log("\n== 執行匯入 ==");
const r = wrangler(["d1", "execute", "DB", ...target, "--file", out, ...(remote ? ["--yes"] : [])]);
process.exit(r.status ?? 1);
