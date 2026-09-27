# 分享功能驗收（2026-09-27，Claude Code on Windows，全程本機）

結果：**75/75 通過**（`result.json`），tsc 0 錯、lint 0 錯（1 個既有警告：layout 的 Google Fonts，不是這輪加的），console error 0。
重跑：`python3 _驗收.py <dev server log 路徑>`。每跑一次會新建一個測試帳號和一則長標題收藏（第 135、136、137 則都是這樣來的，最後一輪是 137）。

## 做了什麼

| 項目 | 位置 |
|---|---|
| 單則頁「分享」「下載分享圖」兩顆次按鈕，放在發文者列下方；被鎖定的不出現 | `網站/components/share-actions.tsx`、`share-detail.tsx` |
| 手機（`pointer: coarse` 且有 `navigator.share`）叫原生分享：標題、文字（藝人・系列・品項・版本）、網址 | 同上 |
| 其他情況展開小選單：複製連結、Facebook、Threads、LINE | 同上 |
| 系列頁、藝人頁「複製連結」（複製的是去掉 `?`、`#` 的網址） | `app/artist/[artist]/page.tsx`、`[no]/page.tsx` |
| 連結預覽：單則、系列、藝人頁共用 `ogMeta()`，og:image 絕對網址＋width／height、twitter:card=summary_large_image | `網站/lib/server/og.ts` |
| 預覽照片＝該頁第一張「有照片且沒被鎖」的收藏；沒有就用站方預設圖 | `Catalog.ogPhotoOf`（`lib/catalog.ts`）、`public/og-default.png`（1200×630，原始檔 `_og-default.html`） |
| 被鎖定的單則：預覽標題改「一則炫收藏」、描述用站方描述、圖用預設圖；被隱藏的本來就 404 | `app/share/[n]/page.tsx` |
| 分享圖：canvas 畫限時動態 1080×1920、貼文 1080×1350，JPEG 0.92；手機能分享檔案就叫分享選單，不然下載 | `網站/lib/share-image.ts` |
| 照片尺寸：`photos.width/height` 帶進 Share（`imageSize`），示範照片補記 1400×933（本機資料與 seed 都改） | `lib/server/content.ts`、`scripts/seed-local.mjs` |

## 驗收數字

### 1. 各平台分享網址（1440 寬實際從選單抓的 href）

第 1 則（`http://localhost:5173/share/1`）：

- Facebook：`https://www.facebook.com/sharer/sharer.php?u=http%3A%2F%2Flocalhost%3A5173%2Fshare%2F1`
- Threads：`https://www.threads.net/intent/post?text=%E5%A4%9C%E8%A1%8C%E6%8E%A1%E9%9B%86%20%E5%8F%B0%E7%81%A3%E9%A6%96%E6%89%B9%E7%B4%99%E5%A5%97%20CD%EF%BC%8C%E8%B7%9F%E6%97%A5%E7%89%88%E6%93%BA%E4%B8%80%E8%B5%B7%20http%3A%2F%2Flocalhost%3A5173%2Fshare%2F1`（＝「夜行採集 台灣首批紙套 CD，跟日版擺一起 http://localhost:5173/share/1」）
- LINE：`https://social-plugins.line.me/lineit/share?url=http%3A%2F%2Flocalhost%3A5173%2Fshare%2F1`

1440 與 390 各兩則（第 1 則、長標題那則）都比對過：三個網址與預期字串逐字相同、選單完整在畫面內（1440：x=782 寬 220；390：x=18 寬 220）、複製連結讀回剪貼簿一致、Esc 與點外面都會收起、頁面無水平溢出。系列頁、藝人頁兩種寬度的複製連結也讀回一致。

### 2. 手機原生分享（390、觸控、`navigator.share` 用記錄器替身）

- 按「分享」：呼叫 1 次，`{title: 夜行採集 台灣首批紙套 CD，跟日版擺一起, text: 山線電台・夜行採集・CD・首批紙套版, url: …/share/1}`，小選單不出現
- 按「下載分享圖 → 限時動態」：呼叫分享，帶 1 個檔 `yinzang-1-story.jpg`（image/jpeg，245,934 bytes）
- 390 沒有 `navigator.share` 時改開小選單（上面第 1 段的 390 結果）

### 3. 連結預覽（curl 用 `facebookexternalhit/1.1` UA）

| 頁面 | og:image | 圖片回應 | meta 尺寸＝實際尺寸 |
|---|---|---|---|
| `/share/1` | `/img/p/demo-share-1.jpg` | 200 image/jpeg 333,739B | 1400×933 ✓ |
| `/share/137`（長標題） | `/img/p/…webp` | 200 image/webp | 1600×1067 ✓ |
| `/share/4`（沒照片） | `/og-default.png` | 200 image/png 28,121B | 1200×630 ✓ |
| `/artist/mountain-radio/1` 系列 | 第一張沒被鎖的收藏照 | 200 image/jpeg | 800×600 ✓ |
| `/artist/mountain-radio` 藝人 | 第一張沒被鎖的收藏照 | 200 image/webp | 1600×1067 ✓ |
| `/artist/faint-signal/1`（底下收藏全被鎖） | `/og-default.png` | 200 | 1200×630 ✓ |

每頁都有 og:title、og:description、og:url、og:image（絕對網址）、og:image:width／height、og:type、og:site_name、twitter:card=summary_large_image、twitter:image。
單則描述：`山線電台・夜行採集・CD・首批紙套版`。

**不洩漏**：

- 鎖定 `share/8`（12 筆檢舉）、`share/6`（版本被鎖）：`<head>` 裡找不到原標題、找不到原照片的 R2 key；og:title＝「一則炫收藏」、og:image＝預設圖
- 管理員隱藏長標題那則 → 404，回應裡沒有原標題、沒有 og:image；恢復
- 管理員隱藏系列 `harbor-fest/1` → 404，回應裡沒有系列名、沒有 og:image；恢復後 200
- 1440、390 兩種寬度，鎖定的兩則都沒有分享與下載分享圖按鈕

### 4. 分享圖（逐張目視過）

| 檔案 | 尺寸 | 大小 | 產生時間 |
|---|---|---|---|
| `img/分享圖_有照片_story_1080x1920.jpg` | 1080×1920 | 246 KB | 205ms |
| `img/分享圖_有照片_post_1080x1350.jpg` | 1080×1350 | 203 KB | 146ms |
| `img/分享圖_長標題_story_1080x1920.jpg` | 1080×1920 | 177 KB | 239ms |
| `img/分享圖_長標題_post_1080x1350.jpg` | 1080×1350 | 142 KB | 197ms |
| `img/分享圖_沒照片_story_1080x1920.jpg` | 1080×1920 | 59 KB | 151ms |
| `img/分享圖_沒照片_post_1080x1350.jpg` | 1080×1350 | 50 KB | 143ms |

- 字型：畫之前 `document.fonts.check` 四組（Noto Sans TC 700／500、Inter 700、IBM Plex Mono 500）全為 true；目視中文是 Noto Sans TC、網址是 Plex Mono
- 長標題：藝人五位＋30 字周邊名稱。限時動態藝人兩行、周邊名稱兩行完整換行；貼文每段一行，藝人那行以「…」截斷。沒有文字超出左右 72px 邊界
- 不經伺服器：產生六張圖期間站內請求 0 個（只有第一次載入 Google Fonts 的字型分段檔），R2 讀取計數 40 → 40 不變；照片直接用頁面上的 `<img>`，toBlob 成功＝canvas 沒被汙染
- 截圖：`img/{1440|390}_share{n}_選單.jpg`、`_分享圖選單.jpg`、`390_share{6|8}_鎖定.jpg`、`{寬}_{系列|藝人}_複製連結.jpg`（135、136 是前兩輪的舊截圖，最後一輪是 137）

## 已知問題與取捨

1. **桌機不叫原生分享**：Windows／Mac 的 Chrome 也有 `navigator.share`，但桌機的系統分享面板找不到 FB、Threads，所以只有觸控裝置走原生，桌機一律小選單
2. **iOS Safari 分享圖可能改成下載**：Safari 要求 `navigator.share` 在點擊後很短時間內呼叫，畫圖＋等字型如果超過，會丟 `NotAllowedError`，程式接住後改下載。本機 headless 量不到，**部署後要用 iPhone 實測**
3. **WebP 當 og:image**：上傳的照片都是 WebP。FB、Threads、LINE 讀不讀 WebP 預覽圖本輪查不到官方原文（**待查證**），部署後用 FB Sharing Debugger 與 LINE 實貼確認；不行的話要改成上傳時多存一張 JPEG 給預覽用（瀏覽器端轉，不加 Workers CPU）
4. **og:url、分享網址取自請求的 Host**：本機是 `http://localhost:5173`，正式環境會是 `https://yinzang.dblzm.workers.dev`；部署後要再用 FB UA 抓一次確認是 https
5. **noindex 不擋預覽**：頁面與 `X-Robots-Tag` 的 noindex 只管搜尋收錄，robots.txt 不擋 `/share`、`/artist`、`/img`，預覽爬蟲讀得到。FB 實際會不會因 noindex 拒絕預覽，**部署後用 Sharing Debugger 實測**
6. **鎖定的收藏 og 還是 200**：頁面照常可看（防詐設計：內容可看、交易暫停），只把預覽換成通用字與預設圖；網址本身還能傳，點進去看得到原內容。要完全不能分享得改成「鎖定就 noindex＋不給網址」，本輪沒做
7. **系列、藝人頁的預覽照挑「最新一則有照片且沒被鎖」**，不是人工挑的封面；被鎖定的品項／版本底下的收藏一併跳過
8. **沒連到系列的收藏**，分享圖第二行用周邊補充或類型，不重複標題（標題本身就是「藝人 類型」）；og 描述只有「藝人・類型」兩段
9. **分享圖留白**：限時動態文字短時（例如第 1 則）發文者到底部之間有一段空白，沒有做垂直置中；IG 限動上下各約 250px 會被介面蓋住，目前字標在頂端 72px，會被蓋到一部分
10. **Google Fonts 連不上**（離線、被擋）時分享圖不會畫，顯示「字型還沒載好，稍等幾秒再試一次」，不退回系統字
11. **Threads 分享網址用 `threads.net`**：照派工規格；Threads 已經有 `threads.com` 網域，`threads.net` 目前仍會導過去（未實測，部署後點一次確認）
12. 下載分享圖選單會蓋住下面的交易區，點外面或 Esc 收起
13. 驗收每跑一次就在本機多一則測試收藏（135、136、137），測試資料＝正式資料不清空，本機資料庫照舊保留
