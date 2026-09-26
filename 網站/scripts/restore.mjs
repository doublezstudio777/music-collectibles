// 把 backup.mjs 匯出的 d1.sql 還原到一個「新的、空的」D1。
//
// wrangler d1 export 的順序是「一張表的 CREATE＋INSERT，再下一張表」，子表（email_codes、sessions…）
// 排在 users 前面，直接執行會在插入時撞 `no such table: main.users`。這支先把語句重排：
// PRAGMA → 全部 CREATE TABLE → 全部 INSERT → 其他（CREATE INDEX…），再執行。
//
// 用法（在 網站/ 底下）：
//   node scripts/restore.mjs <d1.sql> --local --persist-to <空的資料夾>   還原到本機新資料庫（演練）
//   node scripts/restore.mjs <d1.sql> --remote --database <新 D1 名稱>    還原到雲端「新建的空 D1」（不要對正式庫跑）
// 只產生重排後的檔案不執行：加 --dry-run

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
const file = argv[0];
if (!file || file.startsWith("--")) {
  console.error("用法：node scripts/restore.mjs <d1.sql> --local --persist-to <資料夾>｜--remote --database <名稱>");
  process.exit(2);
}
const remote = argv.includes("--remote");
if (remote && !opt("--database")) {
  console.error("--remote 要指定 --database <新建的空 D1 名稱>，不接受正式庫的綁定名稱");
  process.exit(2);
}
if (!remote && !opt("--persist-to")) {
  console.error("--local 要指定 --persist-to <空的資料夾>，避免蓋到開發用的 .wrangler/state");
  process.exit(2);
}

const sql = readFileSync(file, "utf8");
// 語句以「;＋換行」結尾，下一行是 PRAGMA／CREATE／INSERT 開頭才切（字串內容裡的分號換行不會被切開）
const parts = sql.split(/;\n(?=(?:PRAGMA|CREATE|INSERT|DELETE|UPDATE)\b)/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
const kind = (s) =>
  /^PRAGMA/.test(s) ? 0 : /^CREATE TABLE/.test(s) ? 1 : /^INSERT/.test(s) ? 2 : 3;
const ordered = parts.map((s, i) => ({ s, i, k: kind(s) })).sort((a, b) => a.k - b.k || a.i - b.i);
const out = join(dirname(file), "restore.sql");
writeFileSync(out, ordered.map((x) => `${x.s};`).join("\n") + "\n");
const count = [0, 1, 2, 3].map((k) => ordered.filter((x) => x.k === k).length);
console.log(`重排完成：PRAGMA ${count[0]}、CREATE TABLE ${count[1]}、INSERT ${count[2]}、其他 ${count[3]} → ${out}`);
if (argv.includes("--dry-run")) process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = remote
  ? ["d1", "execute", opt("--database"), "--remote", "--file", out]
  : ["d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", opt("--persist-to"), "--file", out];
const r = spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
