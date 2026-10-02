# Spotify 補對＋熱門歌曲區塊提前（2026-10-03）

Cloudflare Version ID `c24899f3`，沒有遷移。部署前備份 `20261003-023250-remote`（寫 Spotify ID 前）、`20261003-023949-remote`（deploy.sh 第 3 步）。

## 一、藝人 Spotify ID 補對

正式站 active 藝人 343 位（`kind='藝人' AND status='approved'`，未刪未隱藏）。改前 151 位有 ID、192 位沒有；改後 **200 位有 ID、143 位沒有**。

- 跑 `網站/scripts/spotify-match.mjs --remote`（規則不變：MusicBrainz 連結優先→手動歌單→搜尋名稱完全相同且作品交集），只用 search 與 get artist，沒打 artist-albums；Spotify 連線 190 次、間隔 1 秒、429 0 次
- 腳本兩處改動：①任何 429 立刻停並存檔（原本短 Retry-After 會等）②`splitNames()`：中英連寫（JOLIN蔡依林）、括號別名（楊淑喻（吉那））、／分隔（Yufu／陳郁夫）都拆開當搜尋名與比對名
- 這次新對到 49 位（舊 151 位全部不變、沒有改判）：MusicBrainz 16（理想混蛋、Hyukoh、路壹 Lu1、JOLIN蔡依林、鶴The Crane、我是機車少女I'mdifficult、J.Sheon、雷擎、LINION、MANDARK、wannasleep、魚條、BRBP、COLD DEW、debloop）、搜尋 33（ADOY、A_Root同根生、Acid Brain酸腦、Tickle Tickle癢癢、Age Factory、BRADD、陳穎達、陳子彰、Dac、Dizparity、Fat Hamster and KANG New、.Feast、Flowstrong、FTK、FUTURE AFTER A SECOND、劉暐、Lomba Sihir、LÜCY、呂紹淳、馬尾、NaraBara、NIO、Oberka、Plutato、PROD_CW、PUZZLEMAN、SHNTI、蘇裔非、TeacheRay、undep、溫室雜草、Wring Out Laura、楊舒雅、楊易修）。每位的證據在 `產出/20260930_Spotify自動抽歌/藝人對應報告.json` 的 `ok`
- 疑義 98 位（舊 38 維持＋舊「找不到」拆名後變疑義 17＋新藝人 43）→ `待確認清單.md`，**沒寫進站**；找不到 45 位不配
- 已寫進正式站 `spotify_artists`（200 列、啟用 200；新 49 位 `albums` 為空，每晚 02:00 排程照清單桶每日 60 的上限抽，估 1 晚補齊）

## 二、區塊位置

- 原本：「在 Spotify 上的熱門歌曲」獨立區塊排在「系列」之後，手機要捲過整排系列才看得到
- 現在：區塊移進藝人頭部 `<header class="artist-head">`，標題「Spotify 熱門歌曲」＋小字「由 Spotify 提供」
  - 手機（≤700）：整寬排在照片＋資訊、「投稿藝人照片」之下、「系列」之前，播放器 352px。152 版面在 390 寬只看得到 3 首半、曲名字小又被截（`img/本機_改後/390_*_播放器152.jpg` vs `_播放器352.jpg`），所以選 352
  - 桌機：第三欄 400px 寬，頂對齊照片、在文字右邊，播放器 152px 精簡版。Spotify 嵌入只有 152 與 352 兩種版面，中間高度（試過 248）會畫成 152 下面留一截空白；352 會比 280px 直式照片高、把系列再往下推 100px，所以用 152。1440 寬「系列」標題在 390px 處，仍在第一屏
  - 沒有 Spotify ID 的藝人整段不渲染，頭部高度＝照片或文字（驗收有量）
- 投稿列 DOM 在 Spotify 之前；桌機用 `order: 1` 讓它換到最後一列，手機 `order: 0` 緊貼照片

## 驗收

- `_驗收_區塊位置.py`：WebKit 390／320（3x、iPhone UA）、1440，量區塊在頭部之內、排在系列之前、整寬／第三欄、播放器高度、沒 ID 不留空位、無溢出、無 console error
  - 本機建置版 68/68（gordon 無照片有 ID、陳綺貞有照片有 ID、李英宏有照片沒 ID、落日飛車都沒有）→ `驗收結果_本機_改後.json`
  - 正式站 56/56（gordon、hyukoh 有 ID；li-ying-hong 沒 ID）→ `驗收結果_正式站_改後.json`
- `_驗收_Spotify播放.py`：iPhone WebKit 390 正式站實際點播放，hyukoh、gordon 都從 Play 變 Pause（未登入 Spotify 是 30 秒試聽）→ `img/正式站_改後/390_Spotify_*_播放前後.jpg`
- 改前對照：`img/正式站_改前/`（部署前的正式站，gordon、hyukoh、li-ying-hong）

## 本機注意

本機 D1（`.wrangler/state`）原本沒有 `spotify_artists` 資料、也沒套 0028／0029，這次套了遷移並塞 gordon、陳綺貞兩筆 Spotify ID 當驗收用（本機測試資料，不影響正式站）。
