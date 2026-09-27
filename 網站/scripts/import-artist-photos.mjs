// 藝人照片：從維基共享資源匯入（2026-09-28）。
//
// 對象：artists.wiki_url 有值、沒被刪除的藝人。
// 1. 條目的代表圖：MediaWiki pageimages（pilicense=any，連合理使用的圖也拿，才能數出「因授權被排除」）；
//    拿到的圖授權不合格時，再試 pilicense=free；pageimages 沒有圖時，從條目 wikitext 的 infobox 圖片欄位找
// 2. imageinfo＋extmetadata 讀 License、LicenseShortName、LicenseUrl、Artist、NonFree。
//    只收：CC0、CC BY（任何版本）、CC BY-SA（任何版本）、公有領域；而且檔案要在維基共享資源（imagerepository=shared）。
//    排除：合理使用（NonFree，或只存在於中文維基本地的檔案）、授權不明（沒有 License）、其他授權（NC、ND、GFDL 單一授權…）
// 3. 下載縮圖，本機用 sharp 轉成長邊 800px 的 JPEG（不放大、依 EXIF 轉正、去掉中繼資料），上傳 R2 `r/{id}.jpg`
// 4. D1：artist_photos 新增一列（source=wiki、status=active），counters.r2_bytes 加上實際位元組（計入 8GB）
//
// 可重跑：已經有使用中照片的藝人、或曾經匯入過維基照片的藝人（不論現在是使用中、被替換、被撤下）一律跳過，不重抓。
// 被撤下的不會因為重跑又回來。SQL 每一句都帶「沒有才建」的條件。
//
// 用法（在 網站/ 底下）：
//   node scripts/import-artist-photos.mjs --local  [--persist-to <資料夾>] [--dry-run] [--limit N]
//   node scripts/import-artist-photos.mjs --remote [--dry-run] [--limit N]     正式環境：先跑 scripts/backup.mjs --remote，失敗就不匯入
// 產出：.wrangler/artist-photos/（縮好的圖與 import-report.json）、.wrangler/import-artist-photos.sql

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("要指定 --remote（正式）或 --local（本機）其中一個");
  process.exit(2);
}
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const persist = opt("--persist-to", ".wrangler/state");
const dry = argv.includes("--dry-run");
const limit = Number(opt("--limit", "0")) || Infinity;
const work = join(root, ".wrangler", "artist-photos");
mkdirSync(work, { recursive: true });

const EDGE = 800;
const QUALITY = 82;
const BUCKET = "yinzang-photos";
const STORAGE_LIMIT = 8 * 1024 ** 3;
const UA = "YueMiCang/1.0 (https://yinzang.dblzm.workers.dev; doublezstudio777@gmail.com) artist-photo-import";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- wrangler ---------- */

const wrangler = (args, capture = false) =>
  spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], {
    cwd: root,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const cfg = remote ? ["--config", "wrangler.production.jsonc"] : ["--config", "wrangler.local.jsonc"];
const d1Target = remote ? ["--remote", ...cfg] : ["--local", ...cfg, "--persist-to", persist];
const r2Target = remote ? ["--remote", ...cfg] : ["--local", ...cfg, "--persist-to", persist];

function query(sql) {
  const r = wrangler(["d1", "execute", "DB", ...d1Target, "--json", "--command", sql], true);
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`查詢失敗：${sql}`);
  }
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")));
  return out[0].results;
}
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

/* ---------- 維基 API ---------- */

async function wikiApi(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } }).catch(() => null);
    if (res?.ok) return res.json();
    await sleep(2000 * (i + 1));
  }
  throw new Error(`維基 API 連不上：${url}`);
}

function titleOf(wikiUrl) {
  const u = new URL(wikiUrl);
  const m = u.pathname.match(/^\/(?:wiki|zh-tw|zh-hant|zh-hk|zh-cn|zh)\/(.+)$/);
  const title = m ? decodeURIComponent(m[1]) : u.searchParams.get("title");
  return { host: u.host, title: title ? title.replace(/_/g, " ") : null };
}

async function pageImage(host, title, license) {
  const d = await wikiApi(host, { action: "query", prop: "pageimages", piprop: "name", pilicense: license, redirects: "1", titles: title });
  const p = d.query?.pages?.[0];
  if (!p || p.missing) return { missing: true, name: null };
  return { missing: false, name: p.pageimage ?? null };
}

/** pageimages 沒圖時：從 wikitext 的 infobox 找圖片欄位 */
async function infoboxImage(host, title) {
  const d = await wikiApi(host, { action: "query", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: title });
  const text = d.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? "";
  const head = text.slice(0, 6000);
  const m = head.match(/\|\s*(?:image|img|圖像|图像|圖片|图片|相片|照片)\s*=\s*(?:\[\[\s*(?:File|Image|檔案|文件|file|image)\s*:)?\s*([^|\]\n}<]+?\.(?:jpe?g|png|webp|tiff?))/i);
  return m ? m[1].trim() : null;
}

async function imageInfo(host, file) {
  const d = await wikiApi(host, {
    action: "query",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "1600",
    iiextmetadatalanguage: "zh-tw",
    titles: `File:${file}`,
  });
  const p = d.query?.pages?.[0];
  if (!p || !p.imageinfo?.[0]) return null;
  return { repo: p.imagerepository ?? "", ...p.imageinfo[0] };
}

const stripHtml = (h) =>
  String(h ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Artist 欄裡第一個連結（使用者頁或個人網站） */
function firstHref(h) {
  const m = String(h ?? "").match(/href="([^"]+)"/);
  if (!m) return null;
  let u = m[1].replace(/&amp;/g, "&");
  if (u.startsWith("//")) u = `https:${u}`;
  if (u.startsWith("/")) u = `https://commons.wikimedia.org${u}`;
  // 紅連結（頁面不存在的使用者頁）改指向使用者頁本身
  const red = u.match(/[?&]title=(User:[^&]+)&action=edit&redlink=1/);
  if (red) u = `https://commons.wikimedia.org/wiki/${red[1]}`;
  return /^https?:\/\//.test(u) ? u : null;
}

/**
 * 授權判定。回傳 { ok, reason, license, licenseUrl }
 * reason：fair_use（合理使用／非自由）｜unknown（授權不明）｜other（其他授權，例如 NC、ND、GFDL 單一授權）｜local（不在共享資源）
 */
export function classify(info) {
  const m = info.extmetadata ?? {};
  const val = (k) => stripHtml(m[k]?.value ?? "");
  const code = val("License").toLowerCase();
  const short = val("LicenseShortName");
  const nonFree = /^(true|1|yes)$/i.test(val("NonFree"));
  const base = { license: short, licenseUrl: val("LicenseUrl") || null };
  if (nonFree || /non-?free|fair use|合理使用/i.test(`${short} ${val("UsageTerms")}`)) return { ok: false, reason: "fair_use", ...base };
  if (info.repo !== "shared") return { ok: false, reason: info.repo === "local" ? "fair_use" : "local", ...base };
  if (!code && !short) return { ok: false, reason: "unknown", ...base };
  if (/(^|-)nc(-|$)|(^|-)nd(-|$)/.test(code) || /NC|ND/.test(short.replace(/SA/g, ""))) return { ok: false, reason: "other", ...base };
  if (code === "cc0" || /^cc0/.test(code) || /^CC0/i.test(short)) return { ok: true, license: "CC0", licenseUrl: base.licenseUrl ?? "https://creativecommons.org/publicdomain/zero/1.0/deed.zh-hant" };
  if (/^pd($|-)/.test(code) || /public domain|公有領域|公共领域/i.test(short)) return { ok: true, license: "公有領域", licenseUrl: base.licenseUrl };
  const cc = code.match(/^cc-by(-sa)?(?:-([\d.]+))?/);
  if (cc) {
    const ver = cc[2] ?? "";
    const name = `CC BY${cc[1] ? "-SA" : ""}${ver ? ` ${ver}` : ""}`;
    const url = base.licenseUrl ?? `https://creativecommons.org/licenses/by${cc[1] ? "-sa" : ""}/${ver || "4.0"}/`;
    return { ok: true, license: short && /^CC BY/i.test(short) ? short : name, licenseUrl: url };
  }
  if (/^CC BY(-SA)?( [\d.]+)?$/i.test(short)) return { ok: true, license: short, licenseUrl: base.licenseUrl };
  return { ok: false, reason: code || short ? "other" : "unknown", ...base };
}

async function download(url) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
    if (res?.ok) return Buffer.from(await res.arrayBuffer());
    await sleep(3000 * (i + 1));
  }
  throw new Error(`下載失敗：${url}`);
}

/* ---------- 主流程 ---------- */

const artistsRows = query(
  `SELECT a.slug, a.name, a.wiki_url AS wikiUrl,
          (SELECT COUNT(*) FROM artist_photos p WHERE p.artist_slug = a.slug AND (p.status = 'active' OR p.source = 'wiki')) AS has
   FROM artists a WHERE a.wiki_url IS NOT NULL AND a.wiki_url != '' AND a.deleted_at IS NULL ORDER BY a.slug`,
);
const report = {
  環境: remote ? "remote" : "local",
  有維基條目的藝人: artistsRows.length,
  已經有照片跳過: 0,
  條目沒有圖: 0,
  找到照片: 0,
  因授權排除: 0,
  排除明細: { 合理使用: 0, 授權不明: 0, 其他授權: 0 },
  成功匯入: 0,
  失敗: 0,
  匯入位元組: 0,
  清單: { 匯入: [], 排除: [], 沒有圖: [], 失敗: [] },
};
const REASON = { fair_use: "合理使用", unknown: "授權不明", other: "其他授權", local: "合理使用" };

const plan = [];
let n = 0;
for (const a of artistsRows) {
  if (a.has > 0) {
    report.已經有照片跳過++;
    continue;
  }
  if (n >= limit) continue; // --limit 只限制要處理的數量，跳過的照樣算進報告
  n++;
  const { host, title } = titleOf(a.wikiUrl);
  try {
    if (!title) throw new Error("網址讀不出條目名稱");
    const any = await pageImage(host, title, "any");
    let file = any.name;
    let how = "pageimages";
    if (!file && !any.missing) {
      file = await infoboxImage(host, title);
      how = "infobox";
    }
    if (!file) {
      report.條目沒有圖++;
      report.清單.沒有圖.push({ slug: a.slug, name: a.name, missing: any.missing });
      continue;
    }
    report.找到照片++;
    let info = await imageInfo(host, file);
    let verdict = info ? classify(info) : { ok: false, reason: "unknown", license: "" };
    const first = { file, how, reason: verdict.reason, license: verdict.license };
    if (!verdict.ok) {
      // 代表圖不合格：看看有沒有別張自由授權的代表圖
      const free = await pageImage(host, title, "free");
      if (free.name && free.name !== file) {
        const info2 = await imageInfo(host, free.name);
        const v2 = info2 ? classify(info2) : { ok: false, reason: "unknown" };
        if (v2.ok) {
          file = free.name;
          info = info2;
          verdict = v2;
          how = "pageimages-free";
        }
      }
    }
    if (!verdict.ok) {
      report.因授權排除++;
      report.排除明細[REASON[verdict.reason] ?? "其他授權"]++;
      report.清單.排除.push({ slug: a.slug, name: a.name, ...first, 原因: REASON[verdict.reason] ?? verdict.reason });
      continue;
    }
    const m = info.extmetadata ?? {};
    const author = stripHtml(m.Artist?.value) || stripHtml(m.Credit?.value) || "不詳";
    const src = info.thumburl && info.width > EDGE ? info.thumburl : info.url;
    const buf = await download(src);
    const out = join(work, `${a.slug}.jpg`);
    const img = await sharp(buf).rotate().resize({ width: EDGE, height: EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    writeFileSync(out, img.data);
    plan.push({
      slug: a.slug,
      name: a.name,
      file,
      how,
      out,
      bytes: img.data.length,
      width: img.info.width,
      height: img.info.height,
      author: author.slice(0, 200),
      authorUrl: firstHref(m.Artist?.value),
      license: verdict.license,
      licenseUrl: verdict.licenseUrl,
      sourceUrl: info.descriptionurl,
    });
    await sleep(400);
  } catch (e) {
    report.失敗++;
    report.清單.失敗.push({ slug: a.slug, name: a.name, error: String(e?.message ?? e) });
  }
}

const total = plan.reduce((s, p) => s + p.bytes, 0);
const [used] = query("SELECT COALESCE((SELECT value FROM counters WHERE key = 'r2_bytes'), 0) AS v");
if (used.v + total > STORAGE_LIMIT) {
  console.error(`容量不夠：已用 ${used.v}，這次 ${total}，上限 ${STORAGE_LIMIT}`);
  process.exit(1);
}

const writeReport = () => {
  writeFileSync(join(work, `import-report-${remote ? "remote" : "local"}${dry ? "-dryrun" : ""}.json`), JSON.stringify(report, null, 2));
  const { 清單, ...nums } = report;
  console.log(JSON.stringify(nums, null, 2));
  console.log(`排除的：${清單.排除.map((x) => `${x.name}（${x.原因}，${x.file}）`).join("、") || "無"}`);
};

if (dry) {
  report.成功匯入 = 0;
  report.預計匯入 = plan.length;
  report.清單.匯入 = plan.map((p) => ({ ...p, out: undefined }));
  writeReport();
  console.log(`--dry-run：縮好的圖在 ${work}，沒有上傳也沒有寫資料庫`);
  process.exit(0);
}

if (remote && plan.length) {
  console.log("\n== 匯入前先備份正式站 ==");
  const b = spawnSync(process.execPath, ["scripts/backup.mjs", "--remote"], { cwd: root, stdio: "inherit" });
  if (b.status !== 0) {
    console.error("備份失敗，停止匯入");
    process.exit(1);
  }
}

// 先把檔案一張張傳到 R2，再用一個 SQL 檔寫 D1（每位藝人：新增列＋容量加上「真的新增的那一列」的位元組）。
// 最後查回哪些真的寫進去了；沒寫進去的（別人先建了）把剛傳的檔刪掉，不留孤兒。
const uploaded = [];
for (const p of plan) {
  const key = `r/${randomBytes(9).toString("base64url")}.jpg`;
  const put = wrangler(["r2", "object", "put", `${BUCKET}/${key}`, ...r2Target, "--file", p.out, "--content-type", "image/jpeg"], true);
  if (put.status !== 0) {
    report.失敗++;
    report.清單.失敗.push({ slug: p.slug, name: p.name, error: `R2 上傳失敗：${(put.stderr || put.stdout).slice(-300)}` });
    continue;
  }
  uploaded.push({ ...p, key });
  process.stdout.write(`已上傳 ${p.name}\n`);
}
if (uploaded.length) {
  const lines = [`INSERT OR IGNORE INTO counters (key, value) VALUES ('r2_bytes', 0);`];
  for (const p of uploaded) {
    lines.push(
      `INSERT INTO artist_photos (artist_slug, source, status, r2_key, thumb_key, content_type, bytes, width, height, author, author_url, license, license_url, source_url, source_file, activated_at, handled_at, note) ` +
        `SELECT ${[p.slug, "wiki", "active", p.key, p.key, "image/jpeg"].map(q).join(", ")}, ${p.bytes}, ${p.width}, ${p.height}, ` +
        `${[p.author, p.authorUrl, p.license, p.licenseUrl, p.sourceUrl, p.file].map(q).join(", ")}, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), ${q(`維基共享資源匯入（${p.how}）`)} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM artist_photos WHERE artist_slug = ${q(p.slug)} AND (status = 'active' OR source = 'wiki'));`,
      `UPDATE counters SET value = value + COALESCE((SELECT bytes FROM artist_photos WHERE r2_key = ${q(p.key)}), 0) WHERE key = 'r2_bytes';`,
    );
  }
  const f = join(root, ".wrangler", "import-artist-photos.sql");
  writeFileSync(f, lines.join("\n") + "\n");
  const r = wrangler(["d1", "execute", "DB", ...d1Target, "--file", f, ...(remote ? ["--yes"] : [])], true);
  if (r.status !== 0) console.error("D1 寫入失敗", (r.stderr || r.stdout).slice(-600));
  const got = new Map(query(`SELECT id, r2_key AS k FROM artist_photos WHERE source = 'wiki' AND r2_key IN (${uploaded.map((p) => q(p.key)).join(", ")})`).map((x) => [x.k, x.id]));
  for (const p of uploaded) {
    const id = got.get(p.key);
    if (!id) {
      wrangler(["r2", "object", "delete", `${BUCKET}/${p.key}`, ...r2Target], true);
      report.失敗++;
      report.清單.失敗.push({ slug: p.slug, name: p.name, error: r.status === 0 ? "已經有照片，沒有新增（檔案已刪回）" : "D1 寫入失敗（檔案已刪回）" });
      continue;
    }
    report.成功匯入++;
    report.匯入位元組 += p.bytes;
    report.清單.匯入.push({ slug: p.slug, name: p.name, id, key: p.key, file: p.file, how: p.how, license: p.license, author: p.author, bytes: p.bytes, size: `${p.width}x${p.height}` });
  }
}
writeReport();
