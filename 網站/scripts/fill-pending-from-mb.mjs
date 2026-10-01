// 補匯的 109 位：Wikidata 補不到類型地區、但 MusicBrainz 對上了的（import-musicbrainz.mjs --set pending，有作品或維基佐證），
// 用 MusicBrainz 藝人資料再補一次。只補空白（gender、region 是 NULL 的），不蓋 Wikidata 或名單填的值。
//   類型：Group → 團體；Person＋Male／Female → 男歌手／女歌手；其他不填
//   地區：國家 TW 或地區在台灣 → 國內；其他國家（不含 XW 全球）→ 國外；沒有 → 不填
// 用法（在 網站/ 底下）：node scripts/fill-pending-from-mb.mjs --local [--persist-to <資料夾>] [--dry-run]｜--remote [--dry-run]
// 先跑 import-pending-artists.mjs 與 import-musicbrainz.mjs --set pending；正式環境匯入前那兩支已經備份過

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE, mb } from "./musicbrainz-fetch.mjs";
import { pendingRows } from "./wikidata-pending.mjs";

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
if (remote === argv.includes("--local")) {
  console.error("要指定 --remote 或 --local");
  process.exit(2);
}
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = remote ? ["--remote", "--config", "wrangler.production.jsonc"] : ["--local", "--config", "wrangler.local.jsonc", "--persist-to", opt("--persist-to", ".wrangler/state")];
const wrangler = (args) =>
  spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const query = (sql) => {
  const r = wrangler(["d1", "execute", "DB", ...target, "--json", "--command", sql]);
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0].results;
};
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const pend = new Set(pendingRows().map((r) => r["網址識別碼"]));
const mapping = JSON.parse(readFileSync(join(CACHE, "mapping-pending.json"), "utf8")).filter((m) => m.status === "ok" && pend.has(m.slug));
const slugs = mapping.map((m) => m.slug);
const site = new Map(query(`SELECT slug, gender, region FROM artists WHERE slug IN (${slugs.map(q).join(",") || "''"})`).map((a) => [a.slug, a]));
const TW = /taiwan|臺灣|台灣|taipei|kaohsiung|tainan|taichung|hsinchu|keelung|taoyuan/i;
const lines = [];
const report = [];
for (const m of mapping) {
  const a = site.get(m.slug);
  if (!a || (a.gender && a.region)) continue;
  const x = await mb(`artist/${m.mbid}`);
  const gender = x.type === "Group" ? "group" : x.type === "Person" && x.gender === "Male" ? "male" : x.type === "Person" && x.gender === "Female" ? "female" : null;
  const tw = x.country === "TW" || TW.test([x.area?.name, x["begin-area"]?.name].filter(Boolean).join(" "));
  const region = tw ? "domestic" : x.country && x.country !== "XW" ? "overseas" : null;
  const set = {};
  if (!a.gender && gender) set.gender = gender;
  if (!a.region && region) set.region = region;
  if (!Object.keys(set).length) {
    report.push({ slug: m.slug, name: m.name, 結果: "MusicBrainz 也沒有可用的類型或地區", type: x.type ?? "", gender: x.gender ?? "", country: x.country ?? "" });
    continue;
  }
  for (const [k, v] of Object.entries(set)) lines.push(`UPDATE artists SET ${k} = ${q(v)} WHERE slug = ${q(m.slug)} AND ${k} IS NULL;`);
  report.push({ slug: m.slug, name: m.name, 結果: "補上", ...set, mbid: m.mbid });
}
const out = join(root, ".wrangler", "fill-pending-from-mb.sql");
writeFileSync(out, lines.join("\n") + "\n");
writeFileSync(join(root, ".wrangler", "fill-pending-from-mb-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ 對上的: mapping.length, 補上: report.filter((r) => r.結果 === "補上").length, 明細: report }, null, 1));
if (argv.includes("--dry-run") || !lines.length) process.exit(0);
const r = wrangler(["d1", "execute", "DB", ...target, "--file", out, ...(remote ? ["--yes"] : [])]);
if (r.status !== 0) console.error(r.stderr);
process.exit(r.status ?? 1);
