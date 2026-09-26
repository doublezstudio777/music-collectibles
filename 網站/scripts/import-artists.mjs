// 藝人匯入：讀 研究/20260927_金曲金音近三屆入圍藝人/ 的 藝人名單.csv（必要）與 維基簡介.csv（有就讀），寫進藝人表。
//
// 這輪（2b）只准本機：寫死 --local，帶 --remote 直接拒絕。正式匯入等 2c，屆時另開參數並先做站外備份。
// 可重跑：同一個網址識別碼（slug）或同一個中文名已經在表裡就跳過，不覆蓋；
// 維基簡介只補「簡介還是空的」藝人，不蓋掉已經有人編輯過的內容。
//
// 網址識別碼（slug）規則照 2026-09-23 定案：英文名或音譯。CSV 有「網址識別碼」欄就用它，
// 否則用英文名轉小寫連字號；兩者都沒有的藝人不匯入，列在報告裡等人工補音譯（slug 一經建立不改，不先給臨時值）。
//
// 維基簡介.csv 預期欄位（欄名含這些字即可）：藝人中文名、維基網址（或「條目網址」）、簡介（或「摘要」）、授權、擷取日期。
// 維基內容授權 CC BY-SA 4.0：藝人頁會顯示「來源：維基百科」＋條目連結＋授權。
//
// 用法：node scripts/import-artists.mjs [--persist-to <資料夾>] [--dry-run] [--dir <CSV 資料夾>]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
if (argv.includes("--remote")) {
  console.error("這輪只准本機匯入，拒絕 --remote（正式匯入等 2c）");
  process.exit(1);
}
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = opt("--dir", join(root, "..", "研究", "20260927_金曲金音近三屆入圍藝人"));
const persist = opt("--persist-to", ".wrangler/state");
const dry = argv.includes("--dry-run");

/** 最小 CSV 解析：雙引號、逗號、換行、BOM */
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

const col = (row, ...keys) => {
  const k = Object.keys(row).find((h) => keys.some((x) => h.includes(x)));
  return k ? row[k] : "";
};

export const toSlug = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const GENDER = { 男歌手: "male", 女歌手: "female", 團體: "group" };
const REGION = { 國內: "domestic", 國外: "overseas" };

function parseAwards(nominated, won) {
  const wonSet = new Set(won.split("；").map((x) => x.trim()).filter(Boolean));
  return nominated
    .split("；")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = x.match(/^(第\d+屆)\s*(金曲獎|金音創作獎|金音)\s*(.+)$/);
      return {
        year: m ? m[1] : "",
        award: m ? (m[2] === "金音" ? "金音創作獎" : m[2]) : x,
        category: m ? m[3].trim() : "",
        result: wonSet.has(x) ? "得獎" : "入圍",
      };
    });
}

const listFile = join(dir, "藝人名單.csv");
if (!existsSync(listFile)) {
  console.error(`找不到 ${listFile}`);
  process.exit(1);
}
const list = parseCsv(readFileSync(listFile, "utf8"));
const wikiFile = join(dir, "維基簡介.csv");
const wiki = existsSync(wikiFile) ? parseCsv(readFileSync(wikiFile, "utf8")) : null;
const wikiBy = new Map((wiki ?? []).map((w) => [col(w, "中文名", "藝人"), w]));

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const lines = [];
const skipped = [];
const seen = new Map();
let wikiCount = 0;

for (const r of list) {
  const name = col(r, "中文名");
  const en = col(r, "英文名");
  const slug = toSlug(col(r, "網址識別碼") || en);
  if (!name) continue;
  if (!slug) {
    skipped.push({ name, why: "沒有英文名或網址識別碼，待補音譯" });
    continue;
  }
  if (seen.has(slug)) {
    skipped.push({ name, why: `網址識別碼 ${slug} 跟「${seen.get(slug)}」撞了` });
    continue;
  }
  seen.set(slug, name);
  const awards = parseAwards(col(r, "入圍"), col(r, "得獎"));
  const top = awards.find((a) => a.result === "得獎") ?? awards[0];
  const tagline = top ? `${top.year}${top.award} ${top.category}${top.result === "得獎" ? "得主" : "入圍"}` : "";
  const aliases = en ? [en] : [];
  lines.push(
    `INSERT INTO artists (slug, name, aliases, kind, gender, region, tagline, awards, source, status) ` +
      `SELECT ${[slug, name, JSON.stringify(aliases), "藝人", GENDER[col(r, "類型")] ?? null, REGION[col(r, "地區")] ?? null, tagline, JSON.stringify(awards), `金曲金音近三屆入圍名單：${col(r, "來源")}`, "approved"].map(q).join(", ")} ` +
      `WHERE NOT EXISTS (SELECT 1 FROM artists WHERE slug = ${q(slug)} OR name = ${q(name)});`,
  );
  const w = wikiBy.get(name);
  const url = w ? col(w, "網址", "URL", "url") : "";
  const intro = w ? col(w, "簡介", "摘要") : "";
  if (w && url && intro) {
    wikiCount++;
    const paras = intro.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    lines.push(
      `UPDATE artists SET intro = ${q(JSON.stringify(paras))}, wiki_url = ${q(url)}, wiki_license = ${q(col(w, "授權") || "CC BY-SA 4.0")}, ` +
        `wiki_fetched_at = ${q(col(w, "日期") || new Date().toISOString().slice(0, 10))}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') ` +
        `WHERE slug = ${q(slug)} AND intro = '[]';`,
    );
  }
}

const out = join(root, ".wrangler", "import-artists.sql");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
const report = join(root, ".wrangler", "import-artists-待補.csv");
writeFileSync(report, "﻿藝人中文名,原因\n" + skipped.map((s) => `${s.name},${s.why}`).join("\n") + "\n");

console.log(`名單 ${list.length} 列｜可匯入 ${seen.size}｜跳過 ${skipped.length}（清單：${report}）`);
console.log(wiki ? `維基簡介 ${wiki.length} 列，對上 ${wikiCount} 位` : "維基簡介.csv 還沒有，這次只匯入名單");
if (dry) {
  console.log(`--dry-run：SQL 寫在 ${out}，沒有執行`);
  process.exit(0);
}
const r = spawnSync(
  process.execPath,
  ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", persist, "--file", out],
  { cwd: root, stdio: "inherit" },
);
process.exit(r.status ?? 1);
