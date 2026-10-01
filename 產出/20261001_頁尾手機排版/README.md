# 頁尾手機排版修正（2026-10-01）

使用者 iPhone 截圖回報兩件事：頁尾連結一行一條太佔空間、版權文字右邊留一大塊空白。已上線，Cloudflare Version ID `d1aea31d`，只改 `網站/app/globals.css`，`ALLOW_INDEXING` 仍 0。

## 根因

1. 連結：手機斷點（≤700px）寫了 `.foot-links { flex-direction: column; }`，當初是怕擠成一列時「新手指南」被拆兩行，結果七條連結各佔一行。
2. 版權文字：不是寬度限制（`p` 實際寬 354px＝容器內寬）。全站 `p { text-wrap: pretty; }` 在 WebKit 的做法是把整段每一行都縮短、求行長平均，390 寬每行右邊空 55～72px，桌機 Safari 也空 85px；Chromium 的 pretty 只調最後幾行，所以 Chrome 看不出來。

## 改了什麼

- 手機連結：`flex-wrap: wrap`、欄距 20px、列距 0、不加分隔符號（DESIGN.md 層級靠間距）；每條 `white-space: nowrap` 不拆字、`inline-flex` 撐到 40px 點擊高度。規則放在 `.foot-links { gap: 16px }` 之後，不然會被蓋掉。桌機不動。
- 版權文字：`.foot-cc p` 改 `text-wrap: wrap`（桌機手機都套，桌機 Safari 同樣受影響）；手機另加 `align-self: stretch`。
- 試過左右對齊（同 `.foot-note`），WebKit 不支援 `text-justify: inter-character`，只撐大半形空格（「©   2026   樂迷藏」），放棄，維持靠左。

## 驗收

`_驗收.py [網址] [img 資料夾]`：WebKit／Chromium × 390／375／360／320（3x）＋1440（1x），截頁尾、量版權文字每行右緣到容器右緣距離（末行不算）、連結列數與右緣、連結高度、有沒有拆字、橫向溢出、console error。

| 項目 | 修正前（正式站） | 修正後（正式站 d1aea31d） |
|---|---|---|
| WebKit 版權文字非末行最大空白 390／375／360／320 | 72／56／41／50px | 4／11／26／14px |
| WebKit 1440 | 85px | 7px |
| Chromium 390／375／360／320／1440 | 22／7／25／12／2px | 同左（Chromium 本來就沒問題） |
| 連結列數（手機） | 7 | 390～360 兩列、320 三列 |
| 連結點擊高度（手機） | 約 21px | 40px |
| 頁尾高度 WebKit 390 | 473px | 310px |
| 連結與版權文字左緣 | 18px | 18px，兩者對齊容器內緣 |

非末行仍有 26px 以內的空白，是標點禁則（句號不能放行首）與「CC BY-NC-ND 4.0」英文整串換行造成的 1～2 字自然參差。

截圖：`img_修正前/`（正式站舊版）、`img/`（本機建置版）、`img_正式站/`（部署後），每個資料夾都有 `量測.json`。

## 沒動、待決定

全站 `p { text-wrap: pretty; }` 還在，iPhone 上其他頁的正文段落一樣會每行右側偏空。這次只修頁尾，要不要全站改 `wrap`（或只在 WebKit 關掉）待使用者決定。
