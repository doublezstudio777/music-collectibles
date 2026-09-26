// 本機示範帳號 seed：把 lib/data.ts 的示範使用者（小孟、阿澤…）與他們的點讚、我有、想要、追蹤寫進「本機」D1。
//
// 規則（第 2 階段技術設計）：示範資料只准走這支腳本，絕不寫進 drizzle/ 的正式遷移；
// 這支只接受本機（寫死 --local，沒有 --remote 的路），正式資料庫永遠不會有假帳號。
// 可重跑：INSERT OR IGNORE，不覆蓋已經存在的列。
//
// 用法：npm run db:migrate:local && npm run db:seed:local
// 示範帳號登入：{帳號}@demo.yinzang.test ／ 密碼 yinzang-demo（阿凱 kai 是未驗證 Email 的示範）

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--remote")) {
  console.error("seed 只准跑本機，拒絕 --remote");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { users } = await import("../lib/data.ts");
const { hashPassword } = await import("../lib/server/crypto.ts");

const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const lines = [];

for (const u of users) {
  const id = `demo-${u.handle}`;
  lines.push(
    `INSERT OR IGNORE INTO users (id, email, email_verified_at, password_hash, handle, name, bio) VALUES (` +
      [id, `${u.handle}@demo.yinzang.test`, u.verified ? now : null, await hashPassword("yinzang-demo"), u.handle, u.name, u.bio]
        .map(q)
        .join(", ") +
      `);`,
  );
  for (const n of u.liked) lines.push(`INSERT OR IGNORE INTO likes (user_id, share_no) VALUES (${q(id)}, ${Number(n)});`);
  for (const k of u.owned) lines.push(`INSERT OR IGNORE INTO holdings (user_id, kind, target_key) VALUES (${q(id)}, 'owned', ${q(k)});`);
  for (const k of u.wanted) lines.push(`INSERT OR IGNORE INTO holdings (user_id, kind, target_key) VALUES (${q(id)}, 'wanted', ${q(k)});`);
  for (const s of u.follows) lines.push(`INSERT OR IGNORE INTO follows (user_id, artist_slug) VALUES (${q(id)}, ${q(s)});`);
}

const file = join(root, ".wrangler", "seed-local.sql");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, lines.join("\n") + "\n");

const r = spawnSync(
  process.execPath,
  [
    "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
    "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--file", file,
  ],
  { cwd: root, stdio: "inherit" },
);
console.log(`示範帳號 ${users.length} 個、共 ${lines.length} 行 SQL`);
process.exit(r.status ?? 1);
