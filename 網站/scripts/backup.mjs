// 音藏站外備份：D1 匯出成 SQL＋R2 照片同步到本機（OneDrive）。
//
// 用法（在 網站/ 底下）：
//   node scripts/backup.mjs --remote            正式環境（要先 wrangler login 或設 CLOUDFLARE_API_TOKEN）
//   node scripts/backup.mjs --local             本機環境（.wrangler/state），試跑用
//   參數：--out <資料夾>  覆蓋備份根目錄；--persist-to <資料夾>  本機環境的狀態資料夾
// 包裝：scripts/backup.sh（Mac／Linux／WSL）、scripts/backup.bat（Windows）
//
// 備份根目錄預設：Windows D:\OneDrive\Claude-Data\_個人資料\音藏\備份，WSL /mnt/d/OneDrive/Claude-Data/_個人資料/音藏/備份；
// Mac 沒有固定路徑，請設環境變數 YINZANG_BACKUP_DIR 或用 --out。
//
// 產出：
//   {根目錄}/{YYYYMMDD-HHmm}-{remote|local}/d1.sql        D1 全部資料表（wrangler d1 export）
//   {根目錄}/{YYYYMMDD-HHmm}-{remote|local}/manifest.json 每張表筆數、這次新下載的照片、孤兒檢查、筆數守恆
//   {根目錄}/R2-{remote|local}/p/…、a/…                   照片（累積同步：只下載本機還沒有的）
// 照片不按日期重複存：檔名是隨機 id、內容不會改，累積一份就夠，manifest 記下每次新增了哪些。

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
const remote = flag("--remote");
if (remote === flag("--local")) {
  console.error("要指定 --remote（正式）或 --local（本機試跑）其中一個");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const persist = opt("--persist-to") ?? ".wrangler/state";
if (persist !== ".wrangler/state") {
  console.error("wrangler d1 export 只讀 .wrangler/state，不支援其他本機資料夾");
  process.exit(2);
}
const where = remote ? "remote" : "local";

function defaultOut() {
  if (process.env.YINZANG_BACKUP_DIR) return process.env.YINZANG_BACKUP_DIR;
  if (process.platform === "win32") return "D:\\OneDrive\\Claude-Data\\_個人資料\\音藏\\備份";
  if (existsSync("/mnt/d/OneDrive/Claude-Data")) return "/mnt/d/OneDrive/Claude-Data/_個人資料/音藏/備份";
  return null;
}
const out = opt("--out") ?? defaultOut();
if (!out) {
  console.error("找不到備份資料夾：請設 YINZANG_BACKUP_DIR 或加 --out <資料夾>");
  process.exit(2);
}

const config = remote ? "wrangler.production.jsonc" : "wrangler.local.jsonc";
const target = remote ? ["--remote"] : ["--local", "--persist-to", persist];
const bucket = "yinzang-photos";

function wrangler(args, { capture = false } = {}) {
  const r = spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`wrangler ${args.slice(0, 3).join(" ")} 失敗`);
    if (capture) console.error((r.stderr || r.stdout || "").slice(-2000));
    process.exit(1);
  }
  return r.stdout;
}

const query = (sql) => {
  const raw = wrangler(["d1", "execute", "DB", ...target, "--config", config, "--json", "--command", sql], { capture: true });
  return JSON.parse(raw.slice(raw.indexOf("[")))[0].results;
};

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const dir = join(out, `${stamp}-${where}`);
const r2dir = join(out, `R2-${where}`);
mkdirSync(dir, { recursive: true });
mkdirSync(r2dir, { recursive: true });

// 1. D1 → SQL
const sqlFile = join(dir, "d1.sql");
console.log(`[1/4] 匯出 D1（${where}）→ ${sqlFile}`);
// d1 export 沒有 --persist-to，本機一律讀 .wrangler/state
wrangler(["d1", "export", "DB", ...(remote ? ["--remote"] : ["--local"]), "--config", config, "--output", sqlFile]);
const bytes = statSync(sqlFile).size;
if (bytes < 100) {
  console.error("匯出的 SQL 太小，視為失敗");
  process.exit(1);
}

// 2. 每張表筆數
console.log("[2/4] 各表筆數");
const tables = query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`).map((r) => r.name);
// 一次查完（每次呼叫 wrangler 要 2～3 秒）
const counts = query(`SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM "${t}") AS "${t}"`).join(", ")}`)[0];

// 3. R2 照片：只下載本機沒有的
console.log("[3/4] 同步 R2 照片");
const keys = query(`SELECT r2_key AS a, thumb_key AS b FROM photos`).flatMap((r) => [r.a, r.b]);
const unique = [...new Set(keys)];
const todo = unique.filter((k) => {
  const file = join(r2dir, ...k.split("/"));
  return !(existsSync(file) && statSync(file).size > 0);
});
const fresh = [];
const missing = [];
// 每次呼叫 wrangler 要 2～3 秒，同時跑 8 個
const getOne = (k) =>
  new Promise((resolve) => {
    const file = join(r2dir, ...k.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    const p = spawn(
      process.execPath,
      ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "r2", "object", "get", `${bucket}/${k}`, "--file", file, ...target, "--config", config],
      { cwd: root, stdio: "ignore" },
    );
    p.on("close", (code) => {
      (code === 0 && existsSync(file) ? fresh : missing).push(k);
      resolve();
    });
  });
const queue = [...todo];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) await getOne(queue.shift());
  }),
);
console.log(`照片 ${unique.length} 個檔，這次新下載 ${fresh.length}，失敗 ${missing.length}`);

// 4. 孤兒檢查與筆數守恆
console.log("[4/4] 孤兒檢查、筆數守恆");
const orphans = query(
  `SELECT (SELECT COUNT(*) FROM likes l LEFT JOIN shares s ON s.no = l.share_no WHERE s.no IS NULL) AS likes,
          (SELECT COUNT(*) FROM follows f LEFT JOIN artists a ON a.slug = f.artist_slug WHERE a.slug IS NULL) AS follows,
          (SELECT COUNT(*) FROM photos WHERE purpose = 'share' AND share_no IS NULL) AS photosWithoutShare`,
)[0];
const prev = readdirSync(out)
  .filter((n) => n.endsWith(`-${where}`) && n < `${stamp}-${where}`)
  .sort()
  .pop();
const shrunk = [];
if (prev && existsSync(join(out, prev, "manifest.json"))) {
  const before = JSON.parse(readFileSync(join(out, prev, "manifest.json"), "utf8")).counts ?? {};
  for (const [t, n] of Object.entries(before)) if ((counts[t] ?? 0) < n) shrunk.push({ table: t, before: n, now: counts[t] ?? 0 });
}
const manifest = {
  at: d.toISOString(),
  where,
  sqlBytes: bytes,
  counts,
  photos: { total: unique.length, downloaded: fresh.length, missing },
  orphans,
  previous: prev ?? null,
  // 筆數變少的表：軟刪除不會讓筆數變少，變少＝有東西被真的刪掉（永久刪除空頁面、清過期 session 屬正常）
  shrunk,
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ dir, sqlBytes: bytes, tables: tables.length, photosNew: fresh.length, missing: missing.length, orphans, shrunk }, null, 2));
if (missing.length) {
  console.error(`有 ${missing.length} 張照片沒下載到，見 manifest.json`);
  process.exit(3);
}
