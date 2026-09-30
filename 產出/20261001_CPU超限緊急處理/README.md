# CPU 超限緊急處理（2026-10-01）

使用者 10/1 台灣 07:41 用 iPhone 登入狀態在正式站點幾下，先出現網站自己的「This page couldn't load」，再出現 Cloudflare Error 1102「Worker exceeded resource limits」（Ray a43714110b876bfd）。

已上線：Cloudflare Version ID `c587439e`（全站連結關掉自動預取）。`ALLOW_INDEXING` 仍是 0，沒有遷移。

## 根因

**CPU 超限，不是記憶體。**觸發點不是「登入者不走快取」，而是**連結自動預取造成的請求爆量**。

1. vinext 的 `<Link>` 預設「連結一進畫面就預取」，每個預取都是一次完整的伺服器渲染（RSC）。一頁有 10～20 個連結（收藏卡片、頁首的搜尋／私訊／炫收藏、頁尾 7 個法務連結），開一頁就同時打 10～30 個請求給 Worker
2. 預取的快取鍵含「從哪一頁來」（路由狀態），同一頁從不同地方點進去就是不同鍵，大多沒命中；`/share/new`、`/search`、`/messages`、`/verify`、`/takedown` 根本不在整頁快取白名單，每次都重新渲染。`/share/new` 預取一次 48～130ms、`/search` 86ms
3. 免費方案每請求 10ms，偶爾超過會放行（成功的請求 P90 61ms 都有過），但同一個人一分鐘內連續十幾個超過就開始擋：擋下來的是 1102，站內換頁拿到錯誤頁就顯示「This page couldn't load」

登入者跟訪客的伺服器端渲染其實一樣（公開頁面不讀 cookie，整頁快取不分登入），登入者只多了 `/api/me` 較重（5～29ms）和頁首幾個私人連結的預取。

### 證據

**GraphQL `workersInvocationsAdaptive`**（2026-09-30 12:00Z～10-01 02:00Z，主對話先查過）：success 11,689 次（P50 6.3ms、P90 61ms、P99 232ms）、exceededResources 56 次（P50 剛好 10.000ms＝撞上限）、exceededMemory 2 次、clientDisconnected 560 次。

**56 次全部是 fetch，沒有 cron**：`workersInvocationsScheduled` 同時段 82 次排程（每 10 分鐘自動補資料 45、Spotify 抽歌 36、每日清理 1）全部 success，最高 9.8ms；超限的時間點也都不在排程分鐘上，而且 subrequests 都是 0。

**超限是一陣一陣的**（同一分鐘、同一資料中心 6～9 次＝一個人開一頁的預取爆量）：

| 時間（UTC） | 資料中心 | 次數 | 版本 |
|---|---|---|---|
| 09-30 12:32 | SJC | 1 | a7a01330 |
| 14:43～14:46 | MRS | 19 | 6e1ce90e |
| 15:31 | ATL | 6 | 8b409623 |
| 15:48 | ATL | 7（另 exceededMemory 2） | 11da02eb |
| 15:59～16:00 | HKG | 15 | db8a4369 |
| **23:41** | **SIN** | **8** | 1addbec0（使用者這次） |

頻率：14 小時 58 次，約占請求 0.5%，但集中在 6 個時段、約 6 個人次，碰到的人一碰就是一整串。

**重現**：這次量測第一輪（修正前、登入狀態）在「我的頁面」自動預取首頁時直接吃到一次 503。

**登入者／訪客各占多少：查不到。**GraphQL 沒有 cookie 或路徑維度；能分的是 Workers Logs（`observability` 已開），但金鑰沒有權限（telemetry API 回 Authentication error），zone 的 HTTP 分析也沒權限。Ray ID 同理查不到。要補的權限見最後一節。

## 各頁 CPU（正式站實測，iPhone 視窗，每頁整頁開一次、等 6 秒）

用 `wrangler tail` 的 cpuTime 以 cf-ray 對到每個請求（tail 會抽樣漏事件，漏掉的標不出來）。登入者用臨時測試帳號 `lmbcpuprobe1001`。

### 頁面本身（HTML）

| 頁面 | 快取命中 | 沒命中（重新渲染） | 備註 |
|---|---|---|---|
| 首頁 `/` | 2～5ms | 191ms | 內容一變動第一個人要重組整包目錄 |
| 藝人 `/artist/li-ying-hong` | 1～2ms | 144ms | 同上（部署後第一次） |
| 系列 `/artist/li-ying-hong/1` | 1ms | 31～45ms | |
| 收藏頁 `/share/9` | 1ms | 23～28ms | |
| 私訊 `/messages` | 不快取 | 13～60ms | 空殼頁，內容由 `/api/threads`（10ms）補 |
| 願望清單 `/me/likes` | 不快取 | 14～77ms | 空殼頁 |
| 設定 `/settings` | 不快取 | 11～18ms | 空殼頁，另打 `/api/me/profile`、`/api/me/blocks` 各 6～9ms |
| 我的頁面 `/u/{帳號}` | 不快取 | 66～108ms | 每次都重新渲染 |
| `/api/me` | 不快取 | 登入 5～29ms、訪客 1～27ms | 每頁都打 |

### 一頁打幾個請求（8 頁合計）

| | 修正前 | 修正後 |
|---|---|---|
| 登入 | 128 個（RSC 預取 89） | 37 個（預取 0） |
| 訪客 | 125 個（RSC 預取 92） | 31 個（預取 0） |
| 非 200 | 1 個 503 | 0 |

修正後上線 3 分鐘內新版本 85 次全部 success（P50 6.1ms），樣本還小，**要看一兩天的 GraphQL 才算數**。

## 已先做的修正（`c587439e`）

`components/link.tsx` 包一層 `next/link`，預設 `prefetch={false}`；全站 44 個檔的 `import Link from "next/link"` 改成 `@/components/link`。真的要預取的連結可以明寫 `prefetch` 蓋過去。

- 代價：點下去才抓那一頁，換頁慢一個來回（約 0.2～0.5 秒，快取命中時更短）。以現在的量這是對的取捨
- 本機建置版驗：首頁 6 秒內預取 0、點卡片／藝人／頁尾／logo 各 1 個請求、console error 0
- 部署：`deploy.sh` 0～4 步過（備份 `20261001-0752-remote`、沒有遷移），第 5 步程式已上傳生效（`c587439e`，`x-yz-build` 已是新版），又卡在 wrangler 設路由「No access」exit 1（金鑰缺 Workers Routes 權限，跟上次一樣）。照上次補救：手動 `keep-assets.mjs save`、`deploy.sh --smoke-only` 6、7、8 步全過（noindex、canonical、og、robots、sitemap、www／http 轉址、瀏覽器煙霧 console error 0、舊網址 404）

## A、B 兩方案

### A. 升級 Workers Paid（US$5／月）

- 每請求 CPU 上限從 10ms 變 30 秒（可調到 5 分鐘），**exceededResources 這類 1102 直接消失**，不用改程式
- 解不了記憶體超限（128MB 兩個方案一樣），目前 14 小時 2 次
- 月費：09-30 一天 12,657 次請求、CPU 合計 29 萬 ms；換算一個月約 40 萬次、900 萬 CPU-ms，Paid 內含 1,000 萬次請求與 3,000 萬 CPU-ms，**預估就是 US$5 整，不會有超額**。流量長到目前約 25 倍才開始多收（超額 US$0.30／百萬次、US$0.02／百萬 CPU-ms）
- D1 額度也跟著變大（讀取每月 250 億列、寫入 5,000 萬列）
- 需要使用者本人在 Cloudflare 後台 Workers & Pages → Plans 升級（帳號 zukawork0312），要綁信用卡

### B. 優化 CPU，留在免費方案

免費方案不可能讓「每一次」都低於 10ms：React 渲染一頁本來就要 10～60ms，內容一變動重組目錄要 140～190ms。B 能做的是**讓超過 10ms 的請求變少、不要連續出現**，免費方案才會放行。

| 項目 | 狀態 | 效果 | 工 |
|---|---|---|---|
| B1 關連結自動預取 | ✅ 已上線 | 每頁請求 11～34 → 2～10，爆量來源拿掉 | 已做 |
| B2 users 觸發器縮小範圍 | 未做 | 現在 users 任何欄位更新都讓全站快取失效＋重組目錄（同意條款、改密碼、侵權次數都算）。改成只有帳號、暱稱、大頭貼、Email 驗證這些公開頁會顯示的欄位才算。今天每個舊會員按「同意」都會清一次全站快取 | 0.5 天（一支遷移：換觸發器，不動表） |
| B3 我的頁面、私訊／願望清單／設定空殼頁進整頁快取 | 未做 | 66～108ms、13～77ms 的頁面變 1～2ms | 0.5～1 天（要確認沒讀 cookie） |
| B4 站內換頁的快取鍵不含「從哪一頁來」 | 未做 | 同一頁從不同地方點進去共用快取，命中率上升 | 1 天（要先查 vinext 回傳內容是否真的因來源而異，不一樣就不能做） |
| B5 目錄改成預先組好 | 未做 | 內容變動後第一個請求 140～190ms 降到幾十 ms | 3～5 天（大改） |

B2＋B3 約 1～1.5 天，能把沒命中的次數再壓一截；B5 是大工程。

### 建議

跟主對話傾向一致：**先升級 A 止血**。B1 已經把爆量拿掉，但目錄重組、個人頁這些單次 100ms 以上的請求還是每天會有，免費方案放不放行不透明。升級後再照 B2 → B3 慢慢做，做完也能降低 Paid 的 CPU 用量（雖然目前離額度很遠）。

## 待使用者

1. 決定 A／B（建議先 A）
2. API 金鑰補權限（同一把就好）：
   - Account → **Workers Observability** → Read（查 Workers Logs：路由、登入與否、Ray ID）
   - Zone lemibox.com → **Analytics** → Read（查每個網址的 5xx）
   - Zone lemibox.com → **Workers Routes** → Read（deploy.sh 第 5 步才不會每次卡住）
3. **臨時測試帳號要不要刪**（正式站 D1）：`users` 1 列（`lmbcpuprobe1001`，Email `lmbcpuprobe1001@example.invalid`，密碼欄是不能登入的假值）、`sessions` 1 列（已設為過期）、`user_activity` 1 列，共 3 列。回「刪」再刪

## 檔案

- `measure.py`：正式站逐頁開、記錄每個請求與 cf-ray（`login` 要有 `probe_token.txt`）
- `join.py`、`parse.py`：把 `wrangler tail --format json` 的輸出以 cf-ray 對到量測紀錄，算每頁 CPU
- `measure_{login,guest}{1,2}.json`：1＝修正前、2＝修正後
