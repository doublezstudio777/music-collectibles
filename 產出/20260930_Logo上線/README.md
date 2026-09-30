# Logo 上線（B 版正方形紙套）

2026-09-30，Claude Code on Windows。素材是用戶選定的 B 版 `樂迷藏_插圖_B_正方形紙套_原檔.svg`。只用插圖，字標是網站現有的「樂迷藏」文字。
同一天先做過長方形紙套版（已部署成 `ead7a2e3`），後來作廢，那一版的檔案與量測搬到 `_作廢長方形版/`，不要再用。

正式站版本：**`0474dd35`**（B 版）。

## 改了哪些檔

| 檔 | 內容 |
|---|---|
| `網站/components/logo-mark.tsx`（新） | 內嵌 SVG 插圖，`aria-hidden` |
| `網站/components/site-header.tsx` | 站名左邊加插圖，字包成 `.logo-text` |
| `網站/app/globals.css` | `.logo` 改 inline-flex、`--logo-nudge: -.75px`；`.logo-mark` 30px；檔尾加 389px 以下、340px 以下兩段頁首縮排 |
| `網站/app/layout.tsx` | 圖示 `<link>` 直接寫在 `<head>`（不走 metadata.icons，vinext 會把它串流到 body） |
| `網站/public/brand/logo-mark.svg`（新） | 完整插圖 |
| `網站/public/favicon.svg` | 取代舊深藍圓盤，簡化小圖示 |
| `網站/public/favicon-16.png`、`favicon-32.png`（新） | PNG 備援 |
| `網站/public/apple-touch-icon.png`（新） | 180×180 |
| `網站/public/og-default.png` | 原本還是「音藏」字樣，改成插圖＋「樂迷藏」 |
| `網站/DESIGN.md` | 新增「Logo」段 |
| 本資料夾 `_og-default.html` | og 預設圖原始檔（取代 `產出/20260927_分享功能驗收/_og-default.html`） |

manifest：網站沒有 manifest，沒新增。

## 導覽列置中量測

`_量測_導覽列置中.py`：對 `.logo` 截圖，插圖與字各自找非白像素的上下緣，算墨跡的垂直中心，不量元素框。寬度 1440／390／375／360／320，訪客與登入各量一次。

- 還沒補償時，插圖墨跡中心比字低 **0.75px**（每種寬度都一樣；320px 插圖縮成 26px 也一樣，偏移是字在字框裡的位置造成的）
- 補 `--logo-nudge: -.75px` 之後（正式站，`量測_B正式站*.json`）：

| 裝置像素比 | 插圖中心 | 字中心 | 差 |
|---|---|---|---|
| 4 倍（量測精度 0.25px） | 14.125 | 14.125 | **0.00**（320px：12.125／12.125） |
| 3 倍（iPhone） | 14.00 | 14.17 | −0.17（=半個裝置像素） |
| 2 倍 | 14.00 | 14.25 | −0.25（=半個裝置像素） |
| 1 倍（本機） | 14.0 | 14.0 | 0.00 |

2 倍與 3 倍的差是那個倍率能畫出的最小一步，再調會往另一邊偏同樣的量。
頁首元素：插圖讓 logo 從 59 變 97px 寬，360px 登入狀態一度超出右緣 7.4px、320px 超出 29px；加了兩段窄螢幕規則後，全部寬度 0 重疊、0 超出。

截圖：`img/B正式站_導覽列_{寬}_{訪客|登入}.jpg`（桌機 1440、手機 390／375／360／320）；量測圖 `img/B正式站_置中量測_*.png`（紅線＝插圖墨跡中心、藍線＝字，兩條重疊）。

## 小圖示（16／32px）

B 版原圖縮到 16px，底線只有 0.6px，又離紙套下框太近，糊成一條粗下框（`img_B/小圖示候選_1x_放大4倍看像素.png` 第一列）。

1. 先試線條加粗（候選 a，線寬 5／64，底線 4／64）：32px 清楚，16px 底線還是黏上下框
2. 所以 16px 拿掉底線（候選 b）：只留正方形紙套＋放大到 17／64 的橘方塊＋唱片，中心孔改無框白點

採用：`favicon.svg`＝b（現代瀏覽器各種尺寸都用 SVG）、`favicon-16.png`＝b、`favicon-32.png`＝a（保留加粗底線）。原始檔 `favicon_16_無底線.svg`、`favicon_32_含底線.svg`。

實際截圖：
- `img/B正式站_favicon_16與32_實際像素.png`（從 lemibox.com 載入，1 倍，白底與 Chrome 分頁灰底）
- `img/B正式站_favicon_svg_16px_放大8倍.png`、`…_32px_放大8倍.png`、`img/B正式站_favicon-32_png_32px_放大8倍.png`
- `img/B正式站_Chrome分頁_實拍.png`：Windows Chrome 開 lemibox.com 的分頁列截圖；`…_圖示放大8倍.png`

## 正式站驗收（lemibox.com，`0474dd35`）

- 部署煙霧測試兩個網址全過（www／http 轉址、noindex、瀏覽器點連結）
- 六個圖示檔 200，內容雜湊與 repo 相同；原始 HTML 的 `<head>` 有 4 個圖示 `<link>`
- og 預設圖：`/about`、`/guide` 的 og:image 是新 `og-default.png`。首頁本來就沒有 og 標籤（不是這次改的）
- **iPhone 主畫面：沒辦法在實機加**。已驗 `apple-touch-icon.png` 180×180 從新網域 200、`<head>` 有 link；`img/B_iPhone主畫面圖示_模擬.png` 是套 iOS 圓角遮罩的模擬圖，不是實機截圖。請用戶用 iPhone Safari 開 lemibox.com →分享→加入主畫面看一次
