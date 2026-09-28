// 部署時保留上一版的前端資產（2026-09-28 部署快取批次）。
//
// 為什麼：Workers 的靜態資產跟著版本走，新版本一上線，上一版的 JS／CSS（檔名帶雜湊）立刻變 404。
// 但新版本傳到各機器要幾秒到幾十秒，這段時間還有舊版本在回舊 HTML（整頁快取的鍵含部署版本，舊版本讀的是舊鍵），
// 舊 HTML 指到的舊檔已經不存在，瀏覽器就報一整排 404（部署後第一次煙霧測試 14～16 筆 console error 就是這個）。
// 已經開著頁面的真人，部署後點站內連結載入舊的延遲載入 chunk 也會 404。
// 所以每次部署都把「最近 7 天內還在線上的舊檔」一起放進新版本；檔名帶雜湊，新舊不會撞名。
//
// 用法（deploy.sh 會自己呼叫，在 網站/ 底下）：
//   node scripts/keep-assets.mjs merge   建置完、部署前：記下這次建置的檔案清單，再把存檔裡 7 天內的舊檔補進 dist/client
//   node scripts/keep-assets.mjs save    部署成功後：把這次建置的檔案存進存檔，標記「最後在線上」＝現在；超過 7 天的舊檔從存檔移除
// 存檔在 網站/.deploy-assets/（不進 git）。換一台電腦部署時存檔是空的，那一次就只有新檔，之後照常累積。

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = join(root, "dist", "client", "_next", "static");
const ARCHIVE = join(root, ".deploy-assets");
const FILES = join(ARCHIVE, "files");
const INDEX = join(ARCHIVE, "index.json");
const CURRENT = join(ARCHIVE, "current-build.json");
const KEEP_MS = 7 * 24 * 3600 * 1000;

const walk = (dir) =>
  existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : [];
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);

const cmd = process.argv[2];
mkdirSync(FILES, { recursive: true });
const index = readJson(INDEX, {}); // 相對路徑 → 最後在線上的時間（ISO）

if (cmd === "merge") {
  const built = walk(STATIC).map((f) => relative(STATIC, f));
  if (!built.length) throw new Error(`找不到建置結果：${STATIC}`);
  writeFileSync(CURRENT, JSON.stringify(built, null, 1));
  const now = Date.now();
  let added = 0;
  for (const [rel, at] of Object.entries(index)) {
    if (now - Date.parse(at) > KEEP_MS) continue;
    const to = join(STATIC, rel);
    const from = join(FILES, rel);
    if (existsSync(to) || !existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    added++;
  }
  console.log(`保留舊資產：這次建置 ${built.length} 個檔，補進 7 天內的舊檔 ${added} 個（存檔共 ${Object.keys(index).length} 個）`);
} else if (cmd === "save") {
  const built = readJson(CURRENT, null) ?? walk(STATIC).map((f) => relative(STATIC, f));
  const now = new Date().toISOString();
  for (const rel of built) {
    const from = join(STATIC, rel);
    if (!existsSync(from)) continue;
    const to = join(FILES, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    index[rel] = now;
  }
  let pruned = 0;
  for (const [rel, at] of Object.entries(index)) {
    if (Date.now() - Date.parse(at) <= KEEP_MS) continue;
    rmSync(join(FILES, rel), { force: true });
    delete index[rel];
    pruned++;
  }
  writeFileSync(INDEX, JSON.stringify(index, null, 1));
  console.log(`存檔這次建置 ${built.length} 個檔；超過 7 天移除 ${pruned} 個；存檔共 ${Object.keys(index).length} 個`);
} else {
  console.error("用法：node scripts/keep-assets.mjs merge|save");
  process.exit(2);
}
