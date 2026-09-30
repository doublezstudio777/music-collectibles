# iPhone Safari 兩個版面 bug（2026-09-30）

正式站 Cloudflare Version ID `560ecfbf`（Bug 1、2）→ `d55add30`（加 Bug 3，現行版）。驗證用 Playwright WebKit（WSL 補裝系統函式庫後可跑），iPhone 條件用 `device_scale_factor=3`，另跑 Chromium 對照。

## Bug 1：首頁頁首下方一條空白帶

**根因不是 WebKit，是登入狀態。** `p.home-tagline` 設計成只給訪客看，登入者靠 `opacity: 0` 隱藏但仍佔位（9/28 為了避免畫面跳動）。用戶截圖是登入狀態，所以看到頁首與灰色帶之間約 67px 空白。主對話用 Chromium 量到正常，是因為量的是訪客。修前 WebKit 與 Chromium 都一樣：訪客 opacity 1、登入 opacity 0、高度都是 23px。9/29 首頁上方加了滿版淺灰帶，把這塊空白襯得更明顯。今天的 Logo／頁首窄螢幕間距、Spotify 首頁卡都不是成因。

**改法**
- 確定是登入者：`data-state="user"` → `display: none`，連同 `.page-wall` 上方 24px 一起收掉，灰色帶直接貼頁首（頁首底線不受影響，實測 y=56 仍是 #dcdcdc）
- 上次是登入的人：`lib/account.tsx` 在讀到登入狀態時寫 `localStorage lmb_auth` 與 `<html data-auth>`；`app/layout.tsx` head 小腳本在第一個畫面前讀回，/api/me 還沒回來就已收起，不會先留空白再跳（`<html>` 加 `suppressHydrationWarning`）
- 訪客照舊顯示；記錄是登入但其實已過期的人，讀到 anon 後標語會淡入一次

## Bug 2：炫收藏「＋加照片」框只剩上下虛線

**根因是 WebKit 在 3 倍螢幕畫小數寬度的虛線。** `.drop` 是 `1.5px dashed`，WebKit 3x 把它吸附成 1.333px（4 個實體像素），左右兩條 dashed 整條不畫。框的位置與寬度都正常（x=18、right=372、父層同寬），不是負邊距或超出父層被裁。最小重現（`_虛線框最小重現.html`）：WebKit 3x 下 1.5px 左邊深色像素 8/798，1px 356/798、2px 381/798；1x、2x 都正常；跟 aspect-ratio 無關。Chromium 全部正常。

**改法**：`.drop` 改 `2px dashed`。全站其他虛線都是 1px，不受影響。

## Bug 3：卡片「開放出價」標籤下框不見

**根因是設計本身，不是 WebKit 裁切。** `.slot-offer`、`.slot-paused` 原本寫 `border-bottom: 0; border-left: 0`，打算靠照片邊當下框和左框，照片偏白時就像被切掉。修前兩個引擎都一樣：下框 0%、左框 0%（只剩角落）。橘色價格、黑色已售出是實心色塊，沒有這個問題。

**改法**：兩者改 `box-shadow: inset 0 0 0 1px`（開放出價黑框、交易暫停淺灰框），四邊都在標籤自己裡面畫，不佔尺寸，高度從 25px 變 24px，跟橘色價格槽一致。已售出（黑底）與劃線價（白 90% 底、無框）照原設計沒動。

**驗證**（`_驗收_狀態槽.py`＋`_驗收_狀態槽四邊.py`）：正式站首頁同一張開放出價卡，把槽位換成四種狀態各截一次（只換 DOM 驗 CSS，不動資料），每邊取最外 4 條像素線量框線覆蓋率。修後 WebKit 3x／Chromium × 390／320，開放出價、交易暫停四邊都 100%；修前下、左兩邊 0～1%。註：元素截圖會多帶 1～3 條頁面背景，只看最外一條像素線會誤判成「下框不見」，要取一個範圍。

## 驗證

| 項目 | 結果 |
|---|---|
| 首頁 訪客／登入／上次登入（/api/me 延遲 3 秒量第一個畫面）× 390/375/360/320 × WebKit/Chromium | 本機建置版與正式站全過；登入者標語 display none、灰色帶距頁首 0；console error 0 |
| 上傳框左右虛線 | 正式站 WebKit 3x：390 左右各 381/798、375 364/765、360 349/729、320 313/639 深色像素 |
| 橫向溢出：/、/artists、/about、/guide、/ranking、/search、/share/new × 4 寬 × 2 引擎 | scrollWidth 全部等於視窗寬 |

登入狀態用 Playwright 攔 `/api/me` 回假帳號，沒動真帳號。WebKit 開正式站 /search 偶爾第一次導航逾時，重試即過，跟這次改動無關（/search 沒改）。

`d55add30` 上線後 WebKit 3x 總覆核（`_驗收_正式站總覆核.py`）：390／375／360／320 首頁登入者標語 none、灰色帶貼頁首、上傳框 2px、scrollWidth 都等於視窗寬。部署時 `deploy.sh` 的生效閘門 90 秒內沒過（過渡期舊 chunk 404），`--smoke-only` 重跑兩個網址全過，首頁引用的 24 個資產都是 200。

截圖：`img/修前_*`、`img/修後_正式站_*`。🟡 沒有 iPhone 實機驗，請用戶用 Safari 重看一次（首頁登入狀態、炫收藏上傳框、開放出價卡片）。
