# pm-music 記憶索引

> 專案事實、決策、待討論一律寫 `00_現況.md`，這裡只記「怎麼跟這個專案工作」的偏好與踩坑。
> Codex 端寫入的行結尾標 ` [Codex]`。

## 偏好與踩坑
- vinext 下 client component 用 `useId()` 會 hydration 不一致（伺服器與瀏覽器 id 不同），單頁唯一的表單直接寫死 id（2026-09-25）
- 驗收用 Playwright 跑 `networkidle`＋`document.fonts.ready`，互動狀態要等 `aria-pressed` 出現才點，否則 localStorage 還沒讀進來（2026-09-25）
- 已售出封面用 opacity 淡化，headless 截圖會出現一塊內框假影（合成圖層切塊）；改用 `color-mix` 算淡色背景，照片才用 opacity（2026-09-26）
- 驗收截圖存 JPEG 品質 80（用戶 9/26 嫌上次 PNG 14MB 太大），驗收腳本留在驗收資料夾可重跑（2026-09-26）
- 修正輪不用重跑整套驗收清單，只挑受影響頁面重驗；沒改到的頁面沿用上一輪驗收結果，README 註明清楚即可（2026-09-26）
- 公開列表要「同一人只留最新一筆」時，改 flatMap 抓每條 thread 的最後一則訊息即可，不用改資料層，訊息歷史仍完整保留給私訊頁（2026-09-26）
- 大改資料結構時先整段重寫資料區塊再用 regex 批次換鍵（版本鍵、連結），比逐處 patch 快；驗收腳本用新 context 跑，不碰使用者 localStorage（2026-09-26）
- PM 在 repo 施工期間，主對話只 `git add` 指定檔案，禁 `git add -A`（2026-09-26 主對話兩筆 commit 誤夾 PM 未完成的網站程式碼）
- 驗證碼、寄信內容本機印在 dev server 輸出：dev server 一律導到 scratchpad 的 log 檔，驗收腳本從 log 用 regex 抓碼；有 Turnstile 小框的頁面 networkidle 等不到，settle 加 8 秒上限（2026-09-27）
- D1 遷移產生後先看 SQL，出現 `__new_` 暫存表＝drizzle 要重建表，違反資料永久保存，退回改設計；「從空資料庫跑」用 `--persist-to` 指到暫存資料夾，不用刪本機 .wrangler/state（2026-09-27）
- `wrangler d1 export` 的 SQL 不能直接還原（子表排在 users 前面，撞 `no such table: main.users`），一律用 `網站/scripts/restore.mjs` 重排後還原到新的空資料庫；`d1 export --local` 只讀 `.wrangler/state`，沒有 `--persist-to`（2026-09-27）
- 驗收腳本要能重跑：本機資料不清空，每次自動挑「還沒被用過」的系列／版本／藝人當測試對象，不寫死（2026-09-27）
- 重啟 dev server 用 scratchpad 的小腳本（awk 比對 PID），不要在同一行指令裡 `pgrep -f`／`pkill -f` 帶關鍵字，會比對到自己的 shell 把自己砍掉（2026-09-27 踩兩次）
- canvas 畫中文要等 `document.fonts.load(字型, 實際要畫的字)`，Google Fonts 中文是分段載入，只等 fonts.ready 不夠；等寬字型鏈要接 Noto Sans TC，不然中文掉到系統等寬字（2026-09-27）
- 正式站 Turnstile 是受管理模式，無頭瀏覽器過不了：WSL 用 CDP 開 Windows Chrome（暫存 profile）只拿 token，再用 API 打註冊／登入；CDP 轉接程式每次連線前要重起，不然第二次會卡住。驗證碼用 Resend API 取信件內文，不用碰 Gmail（2026-09-27）
- Windows 排程叫 WSL 腳本：cmd 傳中文路徑給 wsl.exe 會亂碼，路徑用 `*` 代替中文段；`bash -lc` 不讀 .bashrc，nvm 的 node 要在腳本裡自己載（2026-09-27）
- 正式站行為要用 `npm run build`＋`npm start -- --port 8791` 的建置版驗，dev 不打包，chunk 合併類 bug（如 Link 點不動）只在建置版出現；正式站測登入後畫面、又不能動真帳號時，用 Playwright 攔 `/api/me` 回假帳號（2026-09-27）
- 分辨 `cf-cache-status: HIT` 是哪層：開 `wrangler tail` 打那個網址，有 Worker 執行紀錄＝Worker 自己的 Cache API，沒有＝CDN 層；Cache API 的 `delete` 只清單一資料中心，要擋就擋在 D1（2026-09-28）
- 正式站大量匯入前後都要看 CPU：用 GraphQL `workersInvocationsAdaptive` 看 cpuTime p50／p90 與 errors，免費方案 10ms，內容目錄整張讀，資料一多就 exceededCpu 503；驗收腳本狂重試會讓節流更嚴，打一輪就停（2026-09-28）

- 本機量 Worker CPU：`wrangler dev --inspector-port 9230` 後用 `ws` 套件連 `ws://127.0.0.1:9230/ws` 跑 Profiler（Node 內建 WebSocket 連不上）；dist 若是 `YINZANG_DEPLOY=production` 建的，本機會連錯 D1 全站 500，先重建；curl 打正式站一律加 `-m`，不然 503 時會卡死整個背景迴圈（2026-09-27）
- 驗收腳本會覆寫舊輪 `img/` 截圖：跑前先確認輸出路徑，別事後 `git restore`（2026-09-27 丟過一次新截圖）
- 本機 Miniflare：POST 沒把 body 讀完就回應（例如提早回 403），同一條 keep-alive 連線的下一個請求會 503「worker restarted mid-request」；API 一律先 readBody 再判斷（2026-09-27）
- `deploy.sh` 會用正式設定重建 `dist/`，還開著的本機 8791 建置版會變成 HTML 指到不存在的 chunk（全部 404、元件不 hydrate）；部署後要再驗本機，先重建重啟（2026-09-27）
- 表格包 `overflow-x:auto` 仍整頁溢出：`th` 裡的 `.sr-only` 是 absolute，會逃出沒定位的捲動容器；捲動容器加 `position: relative`（2026-09-27）
- Playwright 免走登入頁：`context.add_cookies([{"name":"yz_session","value":API登入拿到的token,"domain":"127.0.0.1","path":"/","httpOnly":True}])` 直接帶身分開頁；`purgePhotoCache` 只算「真的清掉快取的檔」，沒被請求過的檔不算在 purgedPhotos 裡，新增第三張圖時舊驗收腳本的期望值不一定要跟著變（2026-09-28）
- 驗收用 SQL 改 users（停權、清驗證）會觸發 cv_users 讓 content_version 加 1，量「前後版本不變」要把這類準備動作放在量之前；抓 HTML 數字先去掉 React 插的 `<!-- -->`；舊輪驗收腳本複製到 scratchpad 跑，不覆寫舊輪 img（2026-09-28）
- 本機 `npm start -- --test-scheduled` 對預先打包的 dist 沒作用（`/__scheduled` 404、`/cdn-cgi/handler/scheduled` 回 exception），排程要測就開管理員 API 呼叫同一支函式；儀表板統計有 10 分鐘快取，驗數字跟 `/api/admin/stats` 比不跟 D1 比（2026-09-28）
- 新驗收腳本建的測試資料會弄壞舊腳本：藝人別設 display='on'（上線後第一批數強制顯示）、借照片要挑主圖縮圖分開且沒有預覽圖的；`其他系列與評論區` 的 2h 本身不能重跑（每跑一次在夜貓組多一個系列）（2026-09-28）
- D1 一句最多 100 個綁定參數：`inArray` 帶 id 清單（留言、會員）超過就 500，改 JOIN／子查詢或每 90 個分批；驗收腳本裡 `recompute()` 不帶天數會把 7 天等待期的事件打回待入帳，後面要驗已入帳分數就用 `recompute(8)`（2026-09-28）
- 驗收連續打 `/api/auth/register` 會撞「每 IP 每小時 10 次」，每次註冊前用 SQL 清 `register:%`；舊腳本借同一張照片檔名建了上千則收藏，`/img/` 依檔名只查第一筆，要驗照片隱藏就另建一則有獨立照片的收藏；`_私人/cloudflare.txt` 是 `KEY=值` 格式，用 `set -a; . <(tr -d "\r" < 檔)` 載入，不要印出（2026-09-28）
- 手機長按拖曳用 Playwright CDP `Input.dispatchTouchEvent`（touchStart→等 600ms→分段 touchMove→touchEnd）驗得到，頁面捲動要在元件上掛非 passive 的 touchmove 擋；上傳單張失敗用 `page.route` 對第 N 個 POST `abort()` 模擬。別對既有檔跑 `prettier --write`，會整檔重排出幾百行假 diff（2026-09-28）
