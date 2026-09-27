// 藝人與實體發行匯入（上線後第一批，2026-09-28 改寫；前身是 2b 的金曲金音匯入）。
//
// 來源（repo 的 研究/ 底下）：
//   A. 20260927_顏社本色音樂/藝人.csv       全部 24 位 → 藝人頁強制顯示（display=on）
//   B. 20260927_金曲金音近三屆入圍藝人/藝人名單_v2.csv  「類型」「地區」都不是「待確認」的 → 照一般規則（沒內容不顯示）
//      同資料夾 維基簡介.csv（狀態＝已取得）依中文名對上，補簡介
//   C. 20260927_顏社本色音樂/實體發行.csv   → 系列、品項、版本
//
// 去重用網址識別碼：A、B 重疊的以 A 為主（名字、類型、地區、簡介），入圍與得獎紀錄取 B（A 沒有獎項欄）；
// B 裡類型或地區待確認、但識別碼跟 A 相同的（例：方品融），獎項一樣併進來。
// 維基簡介帶入時記下條目網址、授權 CC BY-SA 4.0、擷取日，藝人頁會顯示出處。A 裡「查無獨立維基條目」那種研究備註不當簡介。
//
// 可重跑（每一句 SQL 都是「沒有才建」）：
//   - 藝人：識別碼已存在、或識別碼已經改名（artist_redirects 有這個舊碼）→ 不建；已存在的只做兩件「只補不蓋」的事：
//     簡介還是空的才補維基簡介、獎項還是空的才補獎項；A 的藝人 display 是 auto 才升成 on
//   - 系列：同藝人（改名的話跟著轉址找到新識別碼）同標題已存在就不建；流水號＝該藝人用過的最大號＋1（含已永久刪除的）
//   - 品項：同系列同品項代號已存在就不建；版本：同品項同版本名已存在就不建
//
// 用法（在 網站/ 底下）：
//   node scripts/import-artists.mjs --local  [--persist-to <資料夾>] [--dry-run]
//   node scripts/import-artists.mjs --remote [--dry-run]     正式環境：先跑 scripts/backup.mjs --remote，失敗就不匯入
// 產出：.wrangler/import-artists.sql（實際執行的 SQL）、.wrangler/import-report.json（數字與對應不到的清單）

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/* ---------- CSV ---------- */

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
const readCsv = (...p) => parseCsv(readFileSync(join(research, ...p), "utf8"));

/* ---------- wrangler ---------- */

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
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")));
  return out[0].results;
}

/* ---------- 對照 ---------- */

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
      return {
        year: m ? m[1] : "",
        award: m ? (m[2] === "金音" ? "金音創作獎" : m[2]) : x,
        category: m ? m[3].trim() : "",
        result: wonSet.has(x) ? "得獎" : "入圍",
      };
    });
}
const awardLine = (awards) => {
  const top = awards.find((a) => a.result === "得獎") ?? awards[0];
  return top ? `${top.year}${top.award} ${top.category}${top.result === "得獎" ? "得主" : "入圍"}` : "";
};
const paras = (t) => t.split(/\n+/).map((x) => x.trim()).filter(Boolean);

/* ---------- 讀來源 ---------- */

const labelRows = readCsv("20260927_顏社本色音樂", "藝人.csv");
const v2Rows = readCsv("20260927_金曲金音近三屆入圍藝人", "藝人名單_v2.csv");
const wikiRows = readCsv("20260927_金曲金音近三屆入圍藝人", "維基簡介.csv");
const releaseRows = readCsv("20260927_顏社本色音樂", "實體發行.csv");

const wikiByName = new Map(wikiRows.filter((w) => w["狀態"] === "已取得" && w["簡介"] && w["維基條目網址"]).map((w) => [w["藝人中文名"], w]));
const v2BySlug = new Map(v2Rows.map((r) => [r["網址識別碼"], r]));
const confirmed = v2Rows.filter((r) => r["類型"] !== "待確認" && r["地區"] !== "待確認");

/** 最終要匯入的藝人：slug → 資料 */
const plan = new Map();
const problems = [];

for (const r of labelRows) {
  const slug = r["網址識別碼"];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    problems.push({ 來源: "顏社本色", 名稱: r["藝人中文名"], 原因: `網址識別碼不合規則：${slug}` });
    continue;
  }
  const v2 = v2BySlug.get(slug);
  const awards = v2 ? parseAwards(v2["入圍紀錄"], v2["得獎紀錄"]) : [];
  const wiki = r["維基條目網址"] && r["簡介"] ? { url: r["維基條目網址"], intro: paras(r["簡介"]) } : null;
  const role = r["在籍狀態"] === "前藝人" ? "前旗下藝人" : "旗下藝人";
  plan.set(slug, {
    slug,
    name: r["藝人中文名"],
    aliases: r["藝人英文名"] ? [r["藝人英文名"]] : [],
    gender: GENDER[r["類型"]] ?? null,
    region: REGION[r["地區"]] ?? null,
    tagline: `${r["廠牌"]}${role}`,
    awards,
    wiki,
    display: "on",
    source: [`顏社本色音樂研究（${FETCHED}）：${r["來源網址"]}`, v2 ? `金曲金音近三屆入圍名單：${v2["來源網址"]}` : ""].filter(Boolean).join("；"),
    from: v2 ? "顏社本色＋金曲金音（合併）" : "顏社本色",
  });
}
let overlap = 0;
for (const r of confirmed) {
  const slug = r["網址識別碼"];
  if (plan.has(slug)) {
    overlap++;
    continue;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    problems.push({ 來源: "金曲金音", 名稱: r["藝人中文名"], 原因: `網址識別碼不合規則：${slug}` });
    continue;
  }
  const awards = parseAwards(r["入圍紀錄"], r["得獎紀錄"]);
  const w = wikiByName.get(r["藝人中文名"]);
  plan.set(slug, {
    slug,
    name: r["藝人中文名"],
    aliases: r["藝人英文名"] ? [r["藝人英文名"]] : [],
    gender: GENDER[r["類型"]] ?? null,
    region: REGION[r["地區"]] ?? null,
    tagline: awardLine(awards),
    awards,
    wiki: w ? { url: w["維基條目網址"], intro: paras(w["簡介"]) } : null,
    display: "auto",
    source: `金曲金音近三屆入圍名單：${r["來源網址"]}`,
    from: "金曲金音",
  });
}
// 同名不同識別碼：匯入名單內部就撞名的，列出來（不擋）
const byName = new Map();
for (const a of plan.values()) byName.set(a.name, [...(byName.get(a.name) ?? []), a.slug]);
for (const [name, slugs] of byName) if (slugs.length > 1) problems.push({ 來源: "名單內部", 名稱: name, 原因: `同名不同識別碼：${slugs.join("、")}` });

/* ---------- 實體發行 → 系列／品項／版本 ---------- */

const ITEM = {
  CD: { id: "cd", kind: "CD", sort: 0 },
  黑膠: { id: "vinyl", kind: "黑膠", sort: 1 },
  卡帶: { id: "cassette", kind: "卡帶", sort: 2 },
  DVD: { id: "bluray", kind: "藍光／DVD", sort: 3 },
  藍光: { id: "bluray", kind: "藍光／DVD", sort: 3 },
  其他周邊: { id: "other", kind: "其他周邊", sort: 9 },
};
const SERIES_TYPE = { EP發行: "EP 發行" };

function edition(row, item) {
  const note = row["版本說明"];
  const y = row["發行年"];
  if (/豪華限定/.test(note)) return "豪華限定版";
  if (/標準版/.test(note)) return "標準版";
  if (/限定|限量|Ltd/.test(note)) return "限定版";
  if (/再版/.test(note) || /（再版）/.test(row["系列名稱"])) return `${y} 再版`;
  if (/USB/.test(note)) return "USB 隨身碟版";
  if (item.id === "bluray") return row["品項"] === "藍光" ? "藍光" : "DVD";
  return `${y} ${item.kind}`;
}
function packaging(row) {
  const note = row["版本說明"];
  const m = note.match(/(\d+x?(?:CD|LP|DVD))/i);
  if (/USB/.test(note)) return "USB 隨身碟";
  if (/不透明彩膠/.test(note)) return "不透明彩膠";
  return m ? m[1] : "";
}
const catno = (note) => (/另有/.test(note) ? "待查證" : note.match(/catno\s*([A-Z0-9][A-Z0-9-]*)/i)?.[1] ?? "待查證");

const releaseProblems = [];
/** key：slug｜標題（去掉「（再版）」） */
const seriesPlan = new Map();
for (const r of releaseRows) {
  const slug = r["藝人網址識別碼"];
  const item = ITEM[r["品項"]];
  if (!plan.has(slug)) {
    releaseProblems.push({ 藝人: slug, 系列: r["系列名稱"], 品項: r["品項"], 原因: "藝人不在這次匯入名單" });
    continue;
  }
  if (!item) {
    releaseProblems.push({ 藝人: slug, 系列: r["系列名稱"], 品項: r["品項"], 原因: "品項對不到類型" });
    continue;
  }
  const title = r["系列名稱"].replace(/（再版）$/, "");
  const key = `${slug}|${title}`;
  const s = seriesPlan.get(key) ?? { slug, title, type: SERIES_TYPE[r["系列類型"]] ?? r["系列類型"], year: r["發行年"], rows: [] };
  if (Number(r["發行年"]) < Number(s.year)) s.year = r["發行年"];
  s.rows.push({ ...r, item });
  seriesPlan.set(key, s);
}

/* ---------- 讀目前狀態（只為了報告數字；SQL 本身都是沒有才建） ---------- */

const st = {
  artists: query(`SELECT slug, name, display FROM artists`),
  redirects: query(`SELECT old_slug AS o, new_slug AS n FROM artist_redirects`),
};
const existing = new Map(st.artists.map((a) => [a.slug, a]));
const moved = new Map(st.redirects.map((r) => [r.o, r.n]));
const nameTaken = new Map(st.artists.map((a) => [a.name, a.slug]));

/* ---------- 產生 SQL ---------- */

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
/** 識別碼改過名的話，跟著轉址找到現在的 */
const cur = (slug) => `COALESCE((SELECT new_slug FROM artist_redirects WHERE old_slug = ${q(slug)}), ${q(slug)})`;
const lines = [];
const report = { 新建藝人: 0, 已存在略過: 0, 改名略過: 0, 同名已存在: [], 強制顯示: 0, 帶維基簡介: 0 };

for (const a of plan.values()) {
  if (moved.has(a.slug)) report.改名略過++;
  else if (existing.has(a.slug)) report.已存在略過++;
  else {
    report.新建藝人++;
    if (nameTaken.has(a.name)) report.同名已存在.push(`${a.name}（新 ${a.slug}／既有 ${nameTaken.get(a.name)}）`);
  }
  if (a.display === "on") report.強制顯示++;
  if (a.wiki) report.帶維基簡介++;
  lines.push(
    `INSERT INTO artists (slug, name, aliases, kind, gender, region, tagline, intro, awards, wiki_url, wiki_license, wiki_fetched_at, source, status, display) ` +
      `SELECT ${[
        a.slug,
        a.name,
        JSON.stringify(a.aliases),
        "藝人",
        a.gender,
        a.region,
        a.tagline,
        JSON.stringify(a.wiki?.intro ?? []),
        JSON.stringify(a.awards),
        a.wiki?.url ?? null,
        a.wiki ? WIKI_LICENSE : null,
        a.wiki ? FETCHED : null,
        a.source,
        "approved",
        a.display,
      ]
        .map(q)
        .join(", ")} ` +
      `WHERE NOT EXISTS (SELECT 1 FROM artists WHERE slug = ${q(a.slug)}) AND NOT EXISTS (SELECT 1 FROM artist_redirects WHERE old_slug = ${q(a.slug)});`,
  );
  // 已存在的只補不蓋
  if (a.wiki) {
    lines.push(
      `UPDATE artists SET intro = ${q(JSON.stringify(a.wiki.intro))}, wiki_url = ${q(a.wiki.url)}, wiki_license = ${q(WIKI_LICENSE)}, wiki_fetched_at = ${q(FETCHED)}, ` +
        `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug = ${cur(a.slug)} AND intro = '[]';`,
    );
  }
  if (a.awards.length) lines.push(`UPDATE artists SET awards = ${q(JSON.stringify(a.awards))} WHERE slug = ${cur(a.slug)} AND awards = '[]';`);
  if (a.display === "on") lines.push(`UPDATE artists SET display = 'on' WHERE slug = ${cur(a.slug)} AND display = 'auto';`);
}

let versionTotal = 0;
let itemTotal = 0;
for (const s of seriesPlan.values()) {
  const slugNow = cur(s.slug);
  const name = `${s.year}《${s.title}》${s.type}`;
  const sources = [...new Set(s.rows.map((r) => r["來源網址"]))];
  const body = [
    ...s.rows.map((r) => `${r["品項"]}・${r["發行年"]}・${r["發行公司"]}${r["版本說明"] ? `：${r["版本說明"]}` : ""}`),
    `資料來源：${sources.join("、")}`,
  ];
  const nextNo =
    `(SELECT MAX(COALESCE((SELECT MAX(no) FROM series WHERE artist_slug = ${slugNow}), 0), ` +
    `COALESCE((SELECT value FROM counters WHERE key = 'series_no:' || ${slugNow}), 0)) + 1)`;
  lines.push(
    `INSERT INTO series (artist_slug, no, title, name, series_type, credits, year, body, guests, compilation, status) ` +
      `SELECT ${slugNow}, ${nextNo}, ${q(s.title)}, ${q(name)}, ${q(s.type)}, json_array(${slugNow}), ${q(s.year)}, ${q(JSON.stringify(body))}, '[]', '[]', 'approved' ` +
      `WHERE NOT EXISTS (SELECT 1 FROM series WHERE artist_slug = ${slugNow} AND title = ${q(s.title)} AND deleted_at IS NULL);`,
  );
  const seriesSel = `SELECT id FROM series WHERE artist_slug = ${slugNow} AND title = ${q(s.title)} AND deleted_at IS NULL`;
  const items = new Map();
  for (const r of s.rows) items.set(r.item.id, r.item);
  for (const it of items.values()) {
    itemTotal++;
    lines.push(
      `INSERT INTO items (series_id, item_id, kind, sort, status) SELECT id, ${q(it.id)}, ${q(it.kind)}, ${it.sort}, 'approved' FROM series ` +
        `WHERE id = (${seriesSel}) AND NOT EXISTS (SELECT 1 FROM items WHERE series_id = (${seriesSel}) AND item_id = ${q(it.id)});`,
    );
  }
  const seen = new Set();
  s.rows
    .slice()
    .sort((a, b) => Number(a["發行年"]) - Number(b["發行年"]))
    .forEach((r, i) => {
      let ed = edition(r, r.item);
      if (seen.has(`${r.item.id}|${ed}`)) ed = `${ed}（${r["發行年"]}）`;
      seen.add(`${r.item.id}|${ed}`);
      versionTotal++;
      const itemSel = `SELECT id FROM items WHERE series_id = (${seriesSel}) AND item_id = ${q(r.item.id)}`;
      lines.push(
        `INSERT INTO versions (item_ref, version_id, edition, year, region, label, catalog, barcode, packaging, contents, tracks, identify_by, data_status, sort, status) ` +
          `SELECT (${itemSel}), 'v' || ((SELECT COUNT(*) FROM versions WHERE item_ref = (${itemSel})) + 1), ` +
          `${[ed, r["發行年"], "台灣", r["發行公司"], catno(r["版本說明"]), "無條碼", packaging(r), "", "", "", "待確認"].map(q).join(", ")}, ${i}, 'approved' ` +
          `WHERE (${itemSel}) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM versions WHERE item_ref = (${itemSel}) AND edition = ${q(ed)});`,
      );
    });
}

const out = join(root, ".wrangler", "import-artists.sql");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");

const summary = {
  環境: remote ? "remote" : "local",
  名單: { 顏社本色: labelRows.length, 金曲金音v2: v2Rows.length, 金曲金音類型地區已確認: confirmed.length, 兩邊重疊: overlap, 合計不重複: plan.size },
  藝人: report,
  實體發行: { 來源列數: releaseRows.length, 系列: seriesPlan.size, 品項: itemTotal, 版本: versionTotal, 對應不到: releaseProblems },
  名單問題: problems,
};
writeFileSync(join(root, ".wrangler", "import-report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (dry) {
  console.log(`--dry-run：SQL 寫在 ${out}，沒有執行`);
  process.exit(0);
}

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
