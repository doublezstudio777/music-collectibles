# 會員選單修正

2026-09-27，Claude Code on Windows。修正式站使用者回報的兩件事：頭像選單點了沒反應、頭像只顯示暱稱第一個字。已部署，Worker 版本 `16e5076b-681f-46f5-ae13-bfec66ca3a3b`。

## 1. 選單點了沒反應

### 根本原因

問題不在選單本身，在正式站**所有** `<Link>` 都點不動。選單裡的項目（我的頁、喜愛清單、私訊、管理後台、設定）都是 `<Link>`，所以看起來像選單壞掉；其實頂端的私訊圖示、「炫收藏」按鈕在正式站一樣點了不換頁。

正式站 console 在點擊時丟出：

```
[vinext] RSC prefetch setup error: TypeError: f is not a function  (link-CKVzuqil.js)
Uncaught TypeError: e is not a function
```

vinext 的 `next/link` 寫法是 `import("./navigation.js").then(m => m.getPrefetchInterceptionContext …)`，動態載入後用原名取函式。正式建置時 rolldown 把 `navigation.js` 併進一個共用 chunk（`index-LS_2DmIv.js`），但動態載入那行沒有補上「取出該模組 namespace」的轉接，拿到的是整個共用 chunk，裡面只有 `C`、`D`、`T` 這種縮過的匯出名，沒有 `getPrefetchInterceptionContext`，點擊就在呼叫處丟錯、導覽中斷。

本機 `npm run dev` 不打包，每個模組各自載入，所以本機一直正常；部署後的煙霧測試只用 curl 看 HTTP 狀態，也抓不到瀏覽器端的錯。

排除過的方向：選單在 mousedown／blur 時收起（不是，`<details>` 點項目時還開著，`elementFromPoint` 取到的就是該連結）、透明層（同上）、水合錯誤（沒有 hydration 相關訊息）。

### 修法

`網站/vite.config.ts` 在瀏覽器端建置加一個 chunk 分組，讓 `vinext/dist/shims/navigation.js` 自己成一個 chunk：

```ts
environments: {
  client: { build: { rolldownOptions: { output: {
    codeSplitting: { groups: [{ name: "vinext-navigation", test: /vinext[\\/]dist[\\/]shims[\\/]navigation\.js$/ }] },
  } } } },
},
```

改完後動態載入那行變成 `import("./vinext-navigation-….js").then(e => e.y)`，正確取到模組 namespace。其他動態載入逐一掃過，都是各自獨立 chunk 或有轉接，沒有第二個同樣的洞。

中間試過只關 `minifyInternalExports`（保留匯出原名），無效：共用 chunk 只匯出被別的 chunk 用到的名稱，`getPrefetchInterceptionContext` 根本不在匯出清單裡。

## 2. 頭像改顯示暱稱

規則寫在 `網站/lib/avatar-label.ts`，頂端頭像（`components/site-header.tsx`）改用它：

| 字寬 | 顯示 | 字級 |
|---|---|---|
| ≤ 2 | 一行全名 | 15px |
| 2～4 | 兩行全名 | 15px |
| 4～6 | 兩行全名 | 11px |
| > 6 | 前 4 個字寬＋「…」，兩行 | 11px |

- 字寬：英文、數字與其他半形字元 0.5，中日韓與全形字元 1
- 頭像框維持 40×40。40px 寬塞不下一行 4 個中文（15px 要 60px），所以超過 2 個字寬就排兩行；使用者說的「最多四個字」在這個框裡是兩行各兩字
- 完整暱稱放在 `title`，`aria-label` 是「暱稱，我的選單」
- 個人頁大頭像、收藏卡片與出價列的小頭像（`ava-lg`、`ava-sm`）還是顯示第一個字，這次沒動

## 驗收

腳本 `_驗收.py`，可重跑。截圖在 `img/`，檔名 `{local|prod}_{暱稱種類}_{寬度}.jpg`，另有兩張選單展開畫面。

- **本機**：`npm run build` 後用 `npm start` 起建置版（跟正式站同一種打包，dev 模式看不出這個 bug）。真登入本機測試管理員，暱稱用 SQL 改本機 D1 輪六種，跑完改回「音藏管理員」。**59/59 過**
- **正式站**：部署後跑。**58/58 過**
- 暱稱六種：阿哲（2）、音藏樂迷（4）、音藏小樂迷（5）、喜歡收藏唱片（6）、黑膠唱片收藏達人（8）、vinyllover（英文 10 字元）。每種 1440 與 390 各一張；每張量頭像 40×40、每行字的 Range rect 都在框內、`scrollWidth` 不超過視窗、文字與字級符合上表、`title`／`aria-label` 是全名
- 選單：我的頁、喜愛清單、私訊、管理後台、設定五項，1440 用滑鼠、390 用觸控，每項實點後網址換到目標頁、選單收起。本機另外點了「登出」，會登出。「清掉追蹤」是按鈕不是 `<Link>`，不受這個 bug 影響，這次沒點
- 部署前後各用匿名瀏覽器點頂端私訊圖示與「炫收藏」：修前正式站停在首頁、console 有上面兩個錯；修後會換頁、0 error
- `tsc` 0 錯；lint 0 error（1 個原本就有的字型 warning）

### 正式站怎麼測暱稱

沒有動任何真實帳號。正式站那一輪**不登入**，用 Playwright 攔截 `/api/me` 回一個假帳號（handle `yztestuser`、admin 為 true、暱稱逐一替換），測的是正式站實際部署的程式與樣式，資料庫零寫入。代價：

- 「我的頁」會連到 `/u/yztestuser`，那個帳號不存在所以是 404 頁，驗收只看點了會不會換頁
- 管理後台、設定等頁面實際內容是未登入狀態；這輪只證明選單項目點得到、導覽會發生，不驗頁面內容

## 部署

`scripts/deploy.sh`（一般部署）0～6 步全過：型別、lint、遷移檔檢查、正式建置、遷移前站外備份（`備份/20260927-0852-remote/`）、套遷移（沒有新遷移）、部署、煙霧測試四項。部署 log 掃過沒有密鑰。

建議之後在煙霧測試加一步：用瀏覽器點一個 `<Link>` 確認會換頁、console 0 error。這次的 bug 在 curl 層完全看不到。這次沒加，等你決定。

## 管理員帳號（只查沒改）

正式 D1 查 `zukawork0312@gmail.com`：

- 帳號存在，handle `dz4277`，狀態 `active`
- Email 已驗證（2026-09-27 00:41 UTC）
- 管理員：是。判斷方式是「Email 在 `ADMIN_EMAILS` 裡且已驗證」，`wrangler.production.jsonc` 的 `ADMIN_EMAILS` 是這個信箱，兩個條件都成立。`role` 欄位是 `user`，這欄不管管理員，不影響
- 目前有 1 個登入中的 session
