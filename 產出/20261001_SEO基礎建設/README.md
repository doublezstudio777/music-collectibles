# SEO 基礎建設＋關閉舊網址＋刪測試帳號（2026-10-01）

用戶核准的一包。**這次沒有開放收錄**：`ALLOW_INDEXING` 維持 0，等法律顧問審完 terms／privacy、用戶最後確認才打開（改 `wrangler.production.jsonc` 一個字、重新部署）。terms、privacy 兩頁內容沒動。

**已上線：Cloudflare Version ID `7183a644`**（2026-10-01 00:36 台灣時間），沒有新遷移（後台覆寫存在既有的 `settings` 表）。部署順序照派工：autofill（`775794b6`，遷移 0025）→ dm（`58d6612e`，遷移 0026）→ 這包，rebase 到含 dm 的 main 後重跑本機驗收才部署。

## 步驟 0：刪測試帳號 lmbtestmypage0930

刪前備份 `D:\OneDrive\Claude-Data\_個人資料\音藏\備份\20261001-0007-remote\`。先對 57 張表的所有文字欄位掃 `lmbtest-mypage-0930`／`lmbtestmypage0930`／`驗收測試0930`，命中的只有下表，確認都是這個帳號的列才執行。D1 用一句多語句（同一個交易）刪：

| 表 | 刪除列數 | 內容 |
|---|---|---|
| users | 1 | `lmbtest-mypage-0930`／暱稱「驗收測試0930」 |
| photos | 4 | 大頭貼 4 列（3 列是驗收時換掉的舊大頭貼，已標刪除、R2 早就刪了；1 列是使用中的） |
| sessions | 1 | |
| rate_limits | 1 | `avatar:lmbtest-mypage-0930:2026-09-30` |
| user_activity | 1 | |

沒有收藏、留言、讚、分數、追蹤、私訊相關的列。彙總修正 `counters.r2_bytes` 20,542,411 → 20,541,317（扣 1,094＝使用中那張大頭貼）；`content_version` 由觸發器自動加（2913→2918），整頁快取跟著換。

R2 刪除：`v/Zf-kajdaz2j7n98S.webp`（1,094 bytes）。刪後 bucket 117 個物件、20,541,317 bytes＝D1 計數。驗證：`/u/lmbtestmypage0930` 404、`/img/v/Zf-kajdaz2j7n98S.webp` 404，全表重掃 0 筆。

### 其他疑似測試帳號（只列，沒刪）

正式站 users 表刪完剩 3 個帳號：

| 帳號 | 暱稱 | Email | 建立時間（UTC） | 判斷 |
|---|---|---|---|---|
| `aftest1001`（id `u-aftest1001`） | 補資料測試1001 | aftest1001@example.invalid | 2026-09-30 16:08 | **測試帳號**，自動補資料（autofill）那輪驗收建的，名稱帶 test、Email 是 example.invalid |
| `chenshangts` | 泰電大樓 | mcgeorge1987@gmail.com | 2026-09-28 15:22 | 看起來是真人（Gmail、有驗證），0 則收藏，不像測試 |
| `dz4277` | 民生鄰居 | 站長 | 2026-09-27 | 站長 |

藝人、系列、收藏的名稱裡沒有 test／測試／驗收（`Sandy Lam Greatest Hits` 是字串撞到 test，不是測試資料）。

## 步驟 1：關閉舊網址 yinzang.dblzm.workers.dev

- `wrangler.production.jsonc`：`workers_dev: false`（不轉址，直接關）
- `deploy.sh`：
  - 煙霧測試預設只驗 `https://lemibox.com`
  - 建置後檢查 `dist/server/wrangler.json` 一定要是 `workers_dev: false`，不是就停（防止哪天有人把舊網址打開）
  - 新增第 8 步「舊網址已關閉」斷言：`yinzang.dblzm.workers.dev` 不能回 200／301／302，也不能帶我們 Worker 才有的 `x-yz-build` 表頭；最多等 90 秒
  - 另外加 SEO 斷言：首頁 canonical＝`https://lemibox.com/`、有 og:image、robots.txt 在 ALLOW_INDEXING=0 時不附 Sitemap、sitemap.xml 正常
- 程式裡寫死 workers.dev 的地方：只剩註解（worker.ts、viewer.ts、smoke-browser.py、img 路由），全部改成「已關閉」的說明，沒有任何程式邏輯依賴舊網址
- 關閉證據：見「正式站驗收」段與 `result_正式站.json` 的 `old_url`

## 步驟 2：SEO 三層架構

### 第一層：自動套用（會員看不到任何 SEO 欄位）

組字規則在 `網站/lib/seo.ts`（前後端共用），套到頁面在 `網站/lib/server/seo.ts`。

| 頁面 | title（後綴「｜樂迷藏」由 layout 接） | description |
|---|---|---|
| 收藏頁 | `Hyukoh《23》2020 韓國再版 CD｜民生鄰居的收藏`；沒連系列的照發文的字：`MC HotDog 帽子｜民生鄰居的收藏` | 藝人《系列》版本，發行年（標題沒出現年份時補），再接內文前 40 字 |
| 系列頁 | 只有一個版本：`理想混蛋《關掉／打開》2022 台灣首版 CD｜曲目、版本與收藏`；多個版本：`Hyukoh《23》2017 專輯｜曲目、版本與收藏`；巡迴、品牌是「周邊、版本與收藏」；周邊與其他是「某某的周邊與其他｜收藏」 | 藝人《系列》，某年發行的專輯。收錄 N 個版本（品項）、N 首曲目、N 則樂迷收藏。再接系列介紹（拿掉網址與「資料來源：」） |
| 藝人頁 | `落日飛車｜專輯、版本與收藏`；發行單位是「發行作品與收藏」 | 名字，定位。樂迷藏收錄 N 個系列、N 則樂迷收藏。再接簡介開頭 |
| 首頁 | `樂迷藏｜樂迷的收藏分享`（不接後綴） | 全站預設描述 |
| 關於、新手指南 | `關於樂迷藏`、`新手指南` | 關於頁第一段、新手指南一句話 |

- 描述一律截在 80 個全形字寬內，數字與中文之間不空格
- **canonical 一律 `https://lemibox.com`**，不照請求的 host；`?edit=1`、`?sort=` 這類參數指回本頁；首頁分頁 `?page=2` 起指自己
- og：`og:url`、`og:image` 都是正式網域絕對網址；**首頁補上 og（站方預設圖 og-default.png）**
- **metadata 改成一律輸出在 `<head>`**：vinext 預設把 title、canonical、robots 串流到 `<body>` 再靠 JS 搬（只有少數爬蟲拿得到 head 版），Google 不認 body 裡的 canonical。`next.config.ts` 設 `htmlLimitedBots: /.*/`，所有人都拿 head 版；沒帶 User-Agent 的請求 worker.ts 補一個，避免 body 版被整頁快取存起來。原本的 `noindex` meta 以前也在 body，這次一起進 head
- 照片 alt：收藏照片 `Hyukoh《23》2020 韓國再版 CD，民生鄰居的收藏照片`（卡片、單則頁、大圖檢視都用這個）；藝人照片 `某某照片`
- 結構化資料（JSON-LD，`@graph`）：

| 頁面 | 類型 |
|---|---|
| 系列頁（專輯、EP、單曲） | `MusicAlbum`（byArtist、datePublished、albumReleaseType、曲目 `MusicRecording`＋時長、MusicBrainz sameAs）＋每個實體唱片版本一個 `MusicRelease`（CD／黑膠／卡帶／藍光 DVD 對到 musicReleaseFormat、發行日、廠牌、曲目數、releaseOf） |
| 版本 | **沒有獨立網址**（版本是系列頁的錨點 `#cd-v1`），所以 `MusicRelease` 放在系列頁，`url`／`@id` 用錨點 |
| 藝人頁 | 團體與未分類 `MusicGroup`（含 album 清單）、男女歌手 `Person`、發行單位 `Organization`；alternateName、image、維基 sameAs |
| 全站 | `BreadcrumbList`（首頁 › 藝人 › 某藝人 › 系列 › 這則）；首頁 `WebSite` |

目錄號、條碼是登入才看得到的辨識細節，**不放進結構化資料**。巡迴、品牌、周邊不是唱片，不出 MusicAlbum。

### 第二層：自動把關（noindex，條件一變自動恢復）

| 對象 | 規則 | 做法 |
|---|---|---|
| 系列頁 | 內容太空（見下方門檻）、待確認的新增、後台勾不收錄 | meta robots |
| 藝人頁 | 簡介不到 30 字、沒有收藏、底下沒有可收錄的主要系列；待確認；後台勾不收錄 | meta robots |
| 收藏頁 | 檢舉達門檻（被鎖＝交易暫停）；沒照片而且內容不到 10 字 | meta robots |
| 已刪除、隱藏、審核中（status≠approved） | 目錄讀不到 | 本來就 404 |
| 待確認的版本 | 不列進 MusicRelease | 結構化資料 |
| 設定、私訊、搜尋、我的頁面（含想要＝願望清單）、登入、後台、API、會員頁 `/u/`、標籤頁、榮譽榜、意見回饋、照片查證、發文與編輯、歷史、`?edit=` | 私人頁、功能頁、跟藝人頁重複的頁 | proxy.ts 加 `X-Robots-Tag: noindex` |

每次渲染重算，整頁快取鍵含內容版本，資料一改頁面就跟著變。例外：「待確認的新增」表沒有內容版本觸發器，後台按確認後最多 5 分鐘生效（快取 TTL）。

**ALLOW_INDEXING=0 時全站一律 noindex**，上面的規則要開放收錄後才看得出差別；本機驗收用 ALLOW_INDEXING=1 的建置逐條驗過。

### 「內容太空」的門檻方案（請用戶決定）

目前做的是 **A 案**（照派工舉的例子）：系列頁「沒有收藏、沒有任何版本有曲目、系列介紹不到 30 字」三個都成立才 noindex；「周邊與其他」只看有沒有收藏。

| 方案 | 系列頁規則 | 以正式站 10/01 資料算，679 個系列 |
|---|---|---|
| **A（現行）** | 有收藏、有曲目、介紹 ≥30 字，任一個就收錄 | 收錄 678、不收錄 1 |
| B（嚴） | 只有曲目不算，要有收藏或介紹 ≥30 字 | 收錄 41、不收錄 638 |

我的建議是**開放收錄時先用 B**。655 個系列的內容只有 MusicBrainz 匯入的曲目，跟 MusicBrainz、Spotify、維基的頁面幾乎一樣，一次丟 600 多頁給 Google，容易被整站判定成「內容單薄」，反而拖累真正有收藏的頁。等收藏、介紹長起來，頁面自動一頁頁轉成收錄。改法只動 `lib/server/seo.ts` 的 `seriesIndex` 一行。藝人頁門檻（簡介 ≥30 字、或有收藏、或有可收錄的系列）兩案都一樣：136 位公開藝人收錄 133、不收錄 3（王ADEN、荒井十一、柯智棠，有獎項但簡介太短）。B 案時藝人頁會跟著變少。

### 第三層：後台手動覆寫 `/admin/seo`

- 「全站 SEO 設定」：標題後綴、預設描述（空白＝站名、內建描述）
- 「頁面 SEO」：首頁、關於頁兩顆按鈕，其他用搜尋框找藝人或系列（`/admin/seo?target=artist:hyukoh` 可以直接連）
- 每頁欄位：自訂標題、自訂描述（輸入框提示字就是自動值，空白＝用自動的）、og 圖（瀏覽器置中裁成 1200×630 JPEG 上傳，存 R2 `g/`，可改回自動）、「不給搜尋引擎收錄這頁」開關、自動判斷結果
- 右邊 Google 搜尋結果預覽，打字即時更新；標題超過 30 字、描述超過 80 字（全形字寬）變橘字提醒，不擋存檔
- 存在 `settings` 表（`seo:site`、`seo:artist:{slug}`、`seo:series:{slug}/{no}`、`seo:page:home`、`seo:page:about`），全部清空就刪列；每次寫入記 admin_log
- 已知限制：藝人改 slug、系列合併後，舊鍵的覆寫不會跟著搬，要到後台重設
- 收藏頁不開放覆寫（一律自動），用戶的清單裡沒有

### sitemap、robots.txt

- `/sitemap.xml` 是索引，底下 `/sitemaps/pages.xml`、`artists-N.xml`、`series-N.xml`、`shares-N.xml`，每檔最多 5,000 筆，超過自動切下一檔
- 只列可收錄的頁（跟頁面 noindex 同一套判斷，不會「sitemap 列了、頁面卻 noindex」）；每次請求現算，新增內容下一次讀就出現；lastmod 用最後修改日
- robots.txt：ALLOW_INDEXING=0 維持現狀（允許爬取、靠 noindex 擋收錄、**不附 sitemap**）；=1 時多一行 `Sitemap: https://lemibox.com/sitemap.xml`。私人頁不用 Disallow 擋，理由跟原本一樣（擋了爬蟲讀不到 noindex）

### 收錄預估（開放收錄時，用 A 案、今天的資料）

| 類型 | 公開頁 | 收錄（進 sitemap） | 不收錄 |
|---|---|---|---|
| 固定頁（首頁、藝人目錄、關於、新手指南、隱私權、條款） | 6 | 6 | 0 |
| 藝人頁 | 136 | 133 | 3 |
| 系列頁 | 679 | 678 | 1 |
| 收藏頁 | 6 | 6 | 0 |
| **合計** | 827 | **823** | 4 |

另外會員頁、標籤頁、榮譽榜等功能頁一律不收錄；B 案時系列頁收錄 41。

## Product／Offer 評估（沒加，只提方案）

**建議現在不加，開放收錄後第二階段再評估。**

- 能加的只有「定價出售」且沒被鎖的收藏；「開放出價」沒有固定價格，不符合 Offer 的 price 必填
- Google 的商品摘要要 `itemCondition`（全新／二手），我們沒有這個欄位，只能從內文猜，猜錯就是不實標示
- 錢貨不經過平台（撮合），頁面上沒有「購買」按鈕，Google 的「商家資訊」類型（merchant listing）要能在頁面上買，不適用；頂多用「產品摘要」（product snippet）
- 已售出要即時改 `SoldOut`，整頁快取跟內容版本走，這點做得到
- 搜尋結果直接秀價格，會把「二手唱片價格」的搜尋流量帶進來，跟「版本資料庫＋收藏展示」的定位不同；也可能被解讀成平台在賣東西，這點跟交易條款、消保責任有關，**需律師確認**
- 方案：等加了「物件狀態」欄位、律師確認後，對「定價出售＋有照片＋沒被鎖」的收藏加 `Product`（name、image、`offers: Offer{price, priceCurrency: TWD, availability, itemCondition, seller: Person}`），不加評分

## 驗收

### 本機（正式站 10/01 00:07 備份還原，rebase 到 main 之後重跑）

- `_驗收_本機.py --phase on`（ALLOW_INDEXING=1 建置）：**110/110**
  - 首頁與固定頁 4、藝人頁 5、系列頁 5、收藏頁 6 的 title／description／canonical／og 實際輸出，全部在 `<head>`；兩個標題範例逐字比對
  - 結構化資料 19 頁用 schema.org 官方詞彙（`schemaorg-current-https.jsonld`）離線驗類別、屬性 domain、列舉值，加 Google 麵包屑規格（ListItem、position、name、item 絕對網址），錯誤 0；Hyukoh《23》4 個版本 → 4 個 MusicRelease（CDFormat／VinylFormat）
  - noindex 規則逐條「改動前→改動後→改回」：太空系列補介紹恢復收錄、檢舉達門檻收藏、刪除的收藏 404、待確認藝人、待確認系列、待確認版本移出 MusicRelease、審核中系列 404；私人頁 17 個網址 X-Robots-Tag；公開頁 7 個沒有
  - sitemap 823 個網址逐一打開全部 200、可收錄；補介紹後太空系列自動進 sitemap
  - 後台：自訂標題描述生效、og 圖上傳（尺寸不對被擋）、不收錄開關同步拿出 sitemap、清空回自動、全站後綴與預設描述、搜尋、操作紀錄、沒登入被擋；Playwright 截圖、390px 無橫向溢出、console error 0
- `_驗收_本機.py --phase off`（ALLOW_INDEXING=0 建置）：**21/21**（全站 meta＋表頭 noindex、meta 在 head、robots 不附 sitemap）
- `scripts/smoke-browser.py` 本機通過；tsc、lint 0 錯
- 輸出：`抽驗_輸出_on.md`（各頁實際 title、description）、`結構化資料_輸出.json`、`result_本機_on.json`、`result_本機_off.json`、`img/`

### 正式站（部署 `7183a644` 後）

- `deploy.sh` 全程通過：遷移前站外備份 `20261001-0036-remote`（D1 沒有待套遷移）、煙霧測試（noindex 表頭與 meta、首頁 canonical 與 og:image、robots.txt 不附 sitemap、sitemap.xml、www 與 http 轉址）、瀏覽器煙霧測試 console error 0、**第 8 步舊網址已關閉（HTTP 404）**
- `_驗收_正式站.py`：**48/48**（唯讀）
  - 12 頁（首頁、關於、新手指南、藝人 3、系列 3、收藏 3）title／description／canonical／og／robots 都在 `<head>`，canonical＝`https://lemibox.com/…`；兩個標題範例逐字對上
  - **ALLOW_INDEXING 仍是 0**：12 頁全部 `<meta name="robots" content="noindex">`＋`X-Robots-Tag: noindex`；robots.txt 維持原狀、沒有 Sitemap 行
  - 結構化資料 12 頁過 schema.org 詞彙檢查，錯誤 0
  - sitemap：pages 6、artists 133、series 678、shares 6，合計 823
  - 舊網址證據：`https://yinzang.dblzm.workers.dev/` 回 `HTTP/2 404`、內文 `error code: 1042`（Cloudflare「這個 workers.dev 子網域沒有啟用」），沒有 `x-yz-build`；`/share/10` 一樣 404。原始表頭存在 `result_正式站.json` 的 `old_url`
  - www、http 仍 301 到 `https://lemibox.com`
- CPU（Cloudflare GraphQL，部署後 12 分鐘）：success 767 次，P50 8.7ms／P90 52.7ms／P99 183.6ms，errors 0；部署前一小時 P50 10.0ms／P90 60.2ms（同期有 28 次 exceededResources，是別的施工時段）。metadata 改成進 head 沒有拉高 CPU
- 輸出：`抽驗_輸出_正式站.md`、`結構化資料_輸出_正式站.json`、`result_正式站.json`

## 開放收錄時要做的事

1. 決定「內容太空」用 A 案還是 B 案（B 案改 `seriesIndex` 一行）
2. `wrangler.production.jsonc` 的 `ALLOW_INDEXING` 改 `"1"`，跑 `scripts/deploy.sh`（煙霧測試會自動改驗「沒有 noindex」「robots.txt 附 sitemap」）
3. Google Search Console 加 `lemibox.com`（網域資源要 DNS TXT，帳號金鑰沒有 DNS 權限，要用戶在 Cloudflare 後台加），提交 `https://lemibox.com/sitemap.xml`
4. `aftest1001` 測試帳號要不要刪，等用戶決定
