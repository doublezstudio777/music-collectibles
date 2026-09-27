# 上線後雜項：預覽圖改大圖、活動紀錄保存 90 天

決策見討論檔「上線後雜項（2026-09-28）」（`討論/20260923_Claude_企劃四項與命名決策.md` 末段）：
分享預覽圖不用小圖、浮水印直接燒進 og:image、活動紀錄保存 90 天。

已部署：`60912986`（`https://yinzang.dblzm.workers.dev`）。遷移 `0006_og_photo.sql`（`photos` 表新增可為 NULL 的
`og_key`，其餘欄位不動）已套用到雲端 D1。正式站沒有建立任何測試資料（部署前後 `shares` 表都是 0 筆）。

## 一、分享預覽圖改大圖（燒浮水印 JPEG）

- 上傳照片時，瀏覽器除了原本的主圖（1600px WebP）、縮圖（480px WebP）外，另外用 canvas 畫一張
  **1200×630 JPEG**，把浮水印「@帳號 · 音藏」直接畫進去（`lib/og-image.ts`，共用 `lib/share-image.ts`
  的 `drawCover`／`drawWatermark`，跟 IG 限動／貼文分享圖同一套畫法，跟網頁上 CSS 浮水印同一個視覺）。
  三張一起送進 `/api/uploads`，伺服器端**不做任何影像處理**（不解碼、不裁切、不加浮水印），只是多存一個
  R2 物件，不增加 CPU。
- 存到 R2 路徑 `p/{id}_og.jpg`，跟主圖、縮圖分開，`photos.bytes` 三張一起算，計入 8GB 容量。
- `og:image`／`twitter:image` 改用這張（`lib/catalog.ts` 的 `ogPhoto()`：有預覽圖就用預覽圖，帶
  `width=1200`、`height=630`、`type=image/jpeg`；沒有就退回舊的縮圖邏輯，給沒有預覽圖的舊收藏用）。
- 伺服器端讀取／權限（`app/img/[...key]/route.ts`、`lib/server/guard.ts`）：預覽圖走公開路徑（跟縮圖同一級，
  不用登入），被隱藏或刪除的收藏一樣 404（`siteStatus()` 的查詢加了 `OR p.og_key = ?1`，否則查不到這張照片、
  永遠當它「不存在」）；隱藏或刪除收藏時的快取清除也加了預覽圖（`purgeSharePhotos`）。
- 未登入依舊拿不到 1600px 大圖（沒改這條規則，只是預覽圖走公開路徑，跟大圖要不要登入是两回事）。
- 沒有預覽圖的舊收藏（正式站目前 0 則）維持用縮圖；不用回補，因為沒有舊資料。
- 申訴證據上傳（`purpose=appeal`）不產生預覽圖，維持只有本人與管理員看得到。

### 改了什麼

`lib/share-image.ts`（`drawCover`／`drawWatermark` 改 export 給新模組共用）、`lib/og-image.ts`（新檔，畫
1200×630 JPEG）、`lib/image.ts`（`uploadImage` 加 `handle` 參數，purpose=share 時多產生並附上 og 檔）、
`components/share-form.tsx`（傳目前登入帳號的 handle）、`db/schema.ts`（`photos.ogKey`）、
`drizzle/0006_og_photo.sql`（新遷移）、`lib/server/photos.ts`（`acceptUpload` 收第三個檔、`MAX_OG_BYTES`
上限、bytes 三張一起算、`purgeSharePhotos` 一起清）、`app/api/uploads/route.ts`（多收 `og` 欄位、回傳
`ogUrl`）、`lib/server/content.ts`（Share 多帶 `og` 欄）、`lib/data.ts`（`Share.og` 型別）、
`lib/catalog.ts`（`ogPhoto()` 優先用預覽圖）、`lib/server/og.ts`（`Photo` 型別加 `type`，`OG_DEFAULT`
補 `type: image/png`）、`lib/server/guard.ts`（`siteStatus` 查詢加 og_key）。

## 二、活動紀錄保存 90 天

- 新模組 `lib/server/cleanup.ts`：`cleanupOldRecords()` 一次清三張表——
  - `user_activity`（每人每天每國一列）：`day` 早於 90 天前的整批刪掉，是主要的清理對象
  - `user_geo`（所在地區狀態）：只清「90 天內都沒登入」的列（`last_login_at` 早於門檻才刪；沒登入過、
    `last_login_at` 是 null 的不動，因為沒有時間可以判斷）
  - `rate_limits`（固定視窗計數）：`reset_at` 早於門檻的視窗清掉（早就結束、之後也沒再被打中）
- 由 Worker 的 **Cron Trigger** 每天跑一次（`worker.ts` 新增 `scheduled` 處理常式，
  `wrangler.production.jsonc` 加 `"triggers": { "crons": ["0 18 * * *"] }`，18:00 UTC＝台灣凌晨 2 點）。
  **Cron Trigger 免費方案可用**（同一個 Worker 最多 5 條，呼叫本身不計入額外費用，一天一次的清理量微不足道）；
  這次部署已確認雲端顯示 `schedule: 0 18 * * *`。
- 清理作業寫操作紀錄：每次跑完寫一筆 `admin_log`（`adminId="system"`，跟既有 webhook 暫停模式同一個慣例），
  記下三張表各清了幾列，後台既有的操作紀錄列表看得到。
- 另外開一支管理員專用端點 `POST /api/admin/cleanup`，手動觸發同一支清理函式（正常靠 Cron 自動跑，這支
  給本機驗收、也給管理員需要時手動催一次用）。

### 改了什麼

`lib/server/cleanup.ts`（新檔）、`worker.ts`（`scheduled` 處理常式）、`wrangler.production.jsonc`
（`triggers.crons`）、`app/api/admin/cleanup/route.ts`（新檔，手動觸發端點）。

## 驗收

本機（`npm run typecheck`／`lint` 皆 0 錯，`build` 通過，雲端 D1 遷移已套用）：

| 驗收腳本 | 結果 |
|---|---|
| `_驗收_本機.py`（本批新驗收：預覽圖產生／浮水印／og 標籤／隱藏 404／未登入行為／90 天保存） | **26/26** |
| `20260928_上線後第一批/_驗收_本機.py`（照片快取、精選排序、識別碼轉址、匯入結果、溢出） | **65/65**（重跑；有一項因新功能改了預期值，改法見下） |
| `20260928_防盜版與管理後台/_驗收_本機.py`（防盜版全套） | **71/71**（重跑，無改動） |
| `20260928_CPU修正/_驗收_快取.py`（整頁快取） | **28/28**（重跑，無改動） |
| `20260928_CPU修正/_驗收_換頁.py`（站內換頁 RSC 快取） | **6/6**（重跑，無改動） |

**對舊驗收腳本的唯一改動**：`20260928_上線後第一批/_驗收_本機.py` 原本挑「最新一則有照片的收藏」驗證
「隱藏 API 清掉幾個快取」，寫死期望值 2（主圖＋縮圖）。這支腳本只實際請求過主圖、縮圖兩個檔，
預覽圖沒被請求過就不會進快取，`purgePhotoCache` 只算「真的清掉的」，所以期望值本來就還是 2，
不用改邏輯；加了一行註解說明新欄位 `og_key` 存在但這裡沒被快取過的原因，避免以後有人看到 `og_key` 
非空又拿 2 這個數字疑惑。

驗收證據：`img/1_預覽圖.jpg`（實際產生的 1200×630 燒浮水印 JPEG）、`驗收紀錄_本機.json`。

## 部署

`scripts/deploy.sh`（`CLOUDFLARE_API_TOKEN`／`CLOUDFLARE_ACCOUNT_ID` 讀自 `_私人/cloudflare.txt`）：
型別／lint／遷移檔檢查 → 建置 → 遷移前站外備份 → 套用遷移（雲端 D1，`0006_og_photo.sql` 已套用，
`d1 migrations list --remote` 回「No migrations to apply」）→ 部署 → 煙霧測試（含 Playwright 換頁）
全部通過。部署後另外連續 **100 次瀏覽首頁，0 個 503**。部署版本 `60912986-869d-4cdb-ae19-e84d2b61872e`，
雲端顯示 Cron `schedule: 0 18 * * *`。

## 待確認

- Cron Trigger 部署後要等到下一次觸發時間（隔天台灣凌晨 2 點）才會第一次真的自動跑；本機已驗證同一支
  函式邏輯正確（91 天前清掉、89 天前保留），正式環境的排程本身無法在部署當下立即驗證，只能確認
  `wrangler deploy` 回報的 `schedule` 欄位存在。若要提前驗證正式環境的排程有沒有觸發，可以看
  `/admin` 後台的操作紀錄有沒有出現 `adminId=system`、`action=清理過期紀錄` 的列，或用
  `POST /api/admin/cleanup`（管理員登入）手動催一次。
