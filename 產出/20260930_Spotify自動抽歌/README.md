# Spotify 自動抽歌（2026-09-30）

首頁「今日推薦單曲」從固定 93 首改成每天從藝人的完整作品裡隨機抽。使用者原話：「抓到冷門也沒關係，我主要是想要真的隨機，而不是只有固定幾個」。

## 做法

1. **藝人對應 Spotify ID**（`網站/scripts/spotify-match.mjs`，本機跑，結果存 `網站/scripts/spotify-artists.json`，寫進 D1 `spotify_artists`）
   - MusicBrainz 藝人頁有唯一一個 Spotify 連結就用
   - 手動歌單裡這位藝人的歌，第一位演出者全部是同一個 ID、名稱也對得上就用
   - 都沒有才搜尋：名稱或別名完全相同的候選，還要跟已知作品（站上系列標題、金曲金音入圍作品、維基簡介《》、手動歌單歌名）有交集，恰好一位才配。對不上、同名多位、沒作品可比的一律不配，列進 `藝人對應報告.json`
   - 手動補：`網站/scripts/spotify-manual.json` 寫 `{"artists": {"識別碼": {"spotifyId": "…", "evidence": "…"}}}`，再跑 `node scripts/spotify-match.mjs --remote --apply`
2. **抽歌**（`網站/lib/server/spotify-draw.ts`）：專輯清單（album＋single、market=TW，分頁抓完）→ 隨機一張 → 曲目 → 隨機一首
   - 跳過曲名有伴奏、純音樂、Instrumental、Inst、Karaoke 的；跳過演出者沒有這位藝人的（合輯、別人的單曲）；Live 與 Remix 保留
   - 最近 10 次抽過的歌盡量不重複
3. **排程**：Worker cron `*/5 18-20 * * *`（原本的 `0 18 * * *` 清理照舊，`worker.ts` 用 event.cron 分辨）（台灣 02:00～04:55 每 5 分鐘一批，一批最多 12 位），當天抽過的不再抽。整晚抽完才讓首頁快取換一次。訪客開首頁只讀 D1，不打 Spotify
4. **首頁**：有自動抽歌的藝人用當天抽到的那首；每天一首、換一首的邏輯沒動（`home-pick.tsx` 沒改）
5. **後台**：`/admin/spotify-picks` 上方多一塊「自動抽歌」狀態（對應數、今天抽了幾首、抽歌池大小、今天用掉的額度、哪個額度被鎖到何時）。手動 API：`POST /api/admin/spotify-draw` `{action:"run"}` 手動跑一批、`{action:"sample", artist, times}` 同一位連抽（不寫紀錄）

## Spotify 規則實測（2026-09-30）

- 2026-02 變更文件說的都對：Top Tracks 回 403、搜尋 limit 11 回 400
- **文件沒寫的**：Get Artist's Albums 的 limit 上限也變 10（20、50 都回 400 Invalid limit）
- **配額**：development mode 的配額按 endpoint 分桶、以開發者帳號計、數字不公開（[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)、[2026-07 變更](https://developer.spotify.com/documentation/web-api/references/changes/july-2026)）。比對時 Get Artist's Albums 打了約 100 次就回 429＋Retry-After 約 86,000 秒，**這個桶鎖到 2026-10-01 約 21:30（台灣時間）**；同一時間 Get Album、Search、Get Track 都正常。Extended quota 要 25 萬月活，申請不了
- 所以設計改成省額度：專輯清單存 D1、30 天才更新；專輯曲目抓過就永久存 `spotify_albums`；每個桶每天自訂上限（專輯清單 60、專輯曲目 80）；429 只鎖那個桶，其他照跑；額度用完時只從已存曲目的專輯裡抽

## 數字

**正式站 Cloudflare Version ID `6e1ce90e`**（遷移 `0022`、`0023` 只新增 4 張表：`spotify_artists`、`spotify_draws`、`spotify_state`、`spotify_albums`；部署前站外備份 `20260930-2141-remote`）。Secret `SPOTIFY_CLIENT_ID`／`SPOTIFY_CLIENT_SECRET` 已放上去，repo、log、產出檔裡沒有金鑰（grep 過）。

藝人對應（站上 231 位藝人，已刪與隱藏的不算）：

| | 位數 |
|---|---|
| 對應成功 | 151（MusicBrainz 88、搜尋＋作品交集 58、手動歌單 5） |
| 疑義（不配） | 38 |
| 找不到 | 42 |

抽歌池（正式站 2026-09-30 當晚手動跑 5 批）：

- 已有專輯清單的 24 位全部抽到，池子 24 列、24 首不同的歌；專輯曲目快取 98 張
- 其餘 127 位在等專輯清單：Get Artist's Albums 被鎖到 2026-10-01 21:35（台灣），之後每晚最多抓 60 次，估計 3～4 晚補齊
- 首頁歌單 75 首＝自動抽的 10 首（24 位裡有 10 位是藝人目錄看得到的）＋手動備援 65 首；今天那首是 Ice Paper 抽到的歌

多樣性（同一位藝人連抽 20 次，`多樣性/` 有每次抽到的歌）：

| 藝人 | 專輯＋單曲 | 本機 20 次不同歌數 | 正式站 20 次不同歌數 |
|---|---|---|---|
| 陳怡婷 | 12 | 19 | 20 |
| Energy | 21 | 15 | 16 |
| 單依純 | 58 | 17 | 14 |

舊清單每位固定 3～5 首。抽法是「先挑專輯再挑歌」（照規格），單曲那張只有一首，所以單曲出現機率比專輯裡的歌高，Energy 的〈放手（復合版）〉20 次出現 3 次就是這樣。

驗收：本機用最新站外備份還原的彩排資料庫跑（抽歌 5 批 24 首、429 退避、後台狀態、首頁 1440／390 今日一首＋換一首，console error 只有本機沒有 R2 照片的 3 個 `/img/` 404）；正式站 `deploy.sh` 兩個網址煙霧測試全過，首頁 1440／390 今日一首＋換一首 console error 0，首頁連續 100 次 200。正式站驗收用的暫時管理員 session（30 分鐘到期）用完已刪，再打回 401。

## 93 首舊清單的處理

**當備援，不刪**。首頁規則：有自動抽歌的藝人只用抽到的歌，手動歌單不再出現；對不到 Spotify、或還沒抽過的藝人才用手動歌單。後台照舊可以新增、停用、刪除。

理由：併進池子等於每位有 3～5 首固定歌加 1 首隨機，固定那幾首出現機率反而比隨機的高，跟「不要只有固定幾個」相反。當備援的話，專輯清單還在補的這幾天、以及對不到 Spotify 的藝人，首頁不會少歌。9/29 手動挑歌時找不到的 6 位，這次對上趙翊帆、方品融，夜貓組、三小湯、雞腿飯、萬志軒仍找不到。

## 待使用者決定

- 疑義 38 位（有同名候選但沒有作品交集，多半是搜尋專輯只回前 10 張，作品沒被搜到）：`藝人對應報告.json` 的 `doubt` 附候選連結，點開確認是本人就寫進 `spotify-manual.json`
- 找不到 42 位：中英名黏在一起的（JOLIN蔡依林、Suming舒米恩、SherryZ鄭雙雙…）搜尋用全名搜不到，要不要拆名再搜
