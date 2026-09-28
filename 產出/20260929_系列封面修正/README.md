# 系列封面修正（2026-09-29）

## 根本原因

**藝人頁「系列」橫排從來沒有接封面邏輯**，跟系列頁「其他系列」「系列頁頂部」是不同段程式碼：

- `app/artist/[artist]/page.tsx`（藝人頁）呼叫 `<SeriesTile>` 時完全沒傳 `photo` 這個 prop，元件拿到
  `undefined` 就畫灰色方塊——不管該系列底下有沒有收藏、有沒有照片，一律灰色。這是舊功能本來就沒做齊，
  不是 MusicBrainz 匯入或去重弄壞的（用 D1 查證：`share #3` 的 `series_key='gordon/5'`、
  `hidden_at`／`deleted_at` 皆為 `null`，系列 `gordon/5` 本身也沒被隱藏或刪除，`photos` 表裡兩張照片
  都在，資料完全正常）。
- `app/artist/[artist]/[no]/page.tsx`（系列頁）裡有自己寫的 `coverOf(w)`，只給「這位藝人的其他系列」
  那段用，系列頁頂部的封面位（`cover cover-lg`）也沒接。三處各管各的，其中一處根本沒接。

驗證方式：直接打 `curl` 抓正式站當時的 HTML，`/artist/gordon` 的「系列」整排 12 張卡片全部只有
`class="cover"`，沒有任何一張是 `cover-photo`；同一藝人的系列頁頂部封面位也是空的 `cover cover-lg`。

## 修法

在 `網站/lib/catalog.ts` 新增 `Catalog.seriesCover(series)`，取代原本散落各處、規則不一致的寫法：

- 掃該系列底下 `sharesOfSeries(w)` 的收藏（隱藏／刪除的收藏在讀取層就已經被 SQL 濾掉，
  `WHERE deleted_at IS NULL AND hidden_at IS NULL`，不用再擋一次）
- 濾掉被鎖定的（`toShareView(s).lock`，多人檢舉／盜版鎖定）
- 剩下的照精選排序取第一則的縮圖：已確認版本（`version.status === "已確認"`）優先 → 讚數高的優先
  → 時間新的優先，跟系列頁版本區塊既有的「精選」排序邏輯（`share-wall.tsx` 的 `sortVersionShares`）
  同一套判斷方式
- 沒有任何符合條件的收藏就回 `null`，畫面照舊灰色方塊

三處呼叫全部改成呼叫同一支函式：

1. `app/artist/[artist]/page.tsx`：藝人頁「系列」橫排的 `<SeriesTile>` 補上 `photo={c.seriesCover(w)}`
2. `app/artist/[artist]/[no]/page.tsx`：系列頁「這位藝人的其他系列」的 `<SeriesTile>` 改用
   `c.seriesCover(w)`，刪掉原本頁面內寫死的 `coverOf`
3. `app/artist/[artist]/[no]/page.tsx`：系列頁頂部封面位新增 `selfCover = c.seriesCover(series)`，
   有值就套 `cover-photo`

首頁熱門藝人區目前是純文字清單，本來就沒有縮圖欄位，這次沒有新增（規格是「如果有縮圖」才共用函式，
現在沒有就不用動）。藝人照片（藝人頁頂部）維持不動，跟這次系列封面無關。

## 快取失效驗證（實測，不是照抄機制推論）

本機用乾淨測試資料庫走一輪完整驗證（`.wrangler/state` 之外的獨立 persist 目錄，不動任何正式或
既有本機資料）：

| 動作 | content_version | `x-yz-cache` | 結果 |
|---|---|---|---|
| 初始（有照片） | v=200 | HIT（暖快取） | 系列卡片 `cover-photo` 正確 |
| 隱藏該收藏（`hidden_at`） | v=200→201 | MISS | 卡片退回灰色方塊 |
| 取消隱藏 | v=201→202 | MISS | 卡片恢復 `cover-photo` |
| 刪除該收藏唯一的照片（`photos.deleted_at`），系列裡另一則收藏剛好也有照片 | v=203→204 | MISS | 卡片改用另一則收藏的縮圖 |
| 再刪掉那則的照片，系列裡沒有任何收藏有照片 | — | — | 卡片退回灰色方塊 |

`shares`、`photos` 表的 insert/update/delete 觸發器本來就會讓 `content_version` 的 `v` 加 1，
`worker.ts` 的整頁快取鍵含這個版本號，所以上面每一步變動後都正確變成 `MISS` 並重新渲染出對的封面。
這條快取失效路徑是既有機制（不是這次新增的），這次驗證的重點是確認「封面來源」這個新邏輯有正確吃到
快取失效後的最新資料，而不是快取著舊的縮圖判斷。

## 正式站驗收

- `/artist/gordon`：《Dr. Paper Vol.3 Sunday Night Slow Jams》卡片顯示用戶上傳的照片
  （`/img/p/h7Di5Oc4kIYrWoar_t.jpg`），螢幕截圖見 `img/gordon_390.jpg`、`img/gordon_1440.jpg`
- `/artist/sunset-rollercoaster`（落日飛車）：`sunset-rollercoaster/1` 系列卡片一併驗證，正確顯示
  `cover-photo`
- `/artist/yeemao`（夜貓組）：目前正式站沒有任何收藏掛在夜貓組系列下（D1 查證 `shares` 表沒有
  `series_key LIKE 'yeemao%'` 的列），所以卡片維持灰色是正確行為，不是漏改
- 本機另外用示範資料（`mountain-radio` 藝人）截圖驗證同一套修正，見
  `img/local_mountain-radio_390.jpg`、`img/local_mountain-radio_1440.jpg`

## 品質關卡

- `npx tsc --noEmit`：0 錯誤
- `npm run lint`：0 錯誤（1 個既有無關警告：`app/layout.tsx` 自訂字型，跟這次改動無關）
- 正式站連續瀏覽 `/artist/gordon` 100 次：503 × 0
- 部署煙霧測試（`scripts/deploy.sh` 第 6、7 步）：資產全 200、console error 0

## 沒動的範圍

- 沒建任何測試資料在正式站，正式站資料庫沒有任何寫入（只做 `SELECT` 查證）
- 沒動用戶既有收藏
- 首頁熱門藝人區沒有縮圖欄位，沒新增
- 藝人照片（藝人頁頂部大圖）完全沒動

## 部署

Cloudflare Version ID `009cbc66-0f80-472c-a0d7-ec786dc66a56`，commit 見下方。
