# 正式網域 lemibox.com 接上線

2026-09-30，Claude Code on Windows。依 `產出/20260930_樂迷藏正式網域上線準備.md` 第 3～5 步施工。

## 結果

- `https://lemibox.com` 接到既有 Worker `yinzang`（Custom Domain），沿用同一個 D1、R2、會員，**沒有新建任何 D1／R2／Worker**
- `www.lemibox.com` 也綁同一個 Worker，由 `worker.ts` 301 到 apex（保留路徑與參數）；`http://lemibox.com` 一樣 301 到 https
- 舊網址 `https://yinzang.dblzm.workers.dev` 照常 200，沒有轉址
- `ALLOW_INDEXING` 維持 0，新網域一樣回 `X-Robots-Tag: noindex` 與 meta noindex
- 寄件網域沒動，仍是 `noreply@notify.dblzm.com`
- 部署版本：`5207757a`（網域與 www 轉址）→ **`a7a01330`（加 http 轉 https，現行）**

## 做了什麼

| 項目 | 做法 | 證據 |
|---|---|---|
| 施工前備份 | `backup.mjs --remote` | `D:\OneDrive\Claude-Data\_個人資料\音藏\備份\20260930-2017-remote\`（53 表、SQL 1,880,850 bytes、R2 26 檔、缺 0）；兩次部署各自又備份一次 |
| 綁 apex | API `PUT /accounts/…/workers/domains`（hostname `lemibox.com`，service `yinzang`） | 回 success、cert_id `c297ebe9…`；憑證約 2 分鐘後生效 |
| 綁 www | 同上（`www.lemibox.com`） | cert_id `57d1d721…` |
| 設定檔 | `wrangler.production.jsonc` 加 `routes`（兩個 `custom_domain: true`），讓之後 `wrangler deploy` 維持綁定 | deploy 輸出列出 `lemibox.com (custom domain)`、`www.lemibox.com (custom domain)`；`deploy.sh` 建置後檢查 dist 設定有帶 routes |
| Turnstile | 既有 widget `0x4AAAAAAFEx6pj-sHlnKx92` 的 domains 加 `lemibox.com`、`www.lemibox.com`，site key／secret 不變 | API 回 domains 三個；lemibox.com 實際拿得到 token、註冊登入過了 |
| www、http 轉址 | `worker.ts` 最前面判斷 host／protocol，301 到 `https://lemibox.com` | 金鑰沒有 Redirect Rules 與 zone 設定權限，所以在 Worker 做 |
| 部署腳本 | `deploy.sh` 支援 `--url`（可重複）、`--smoke-only`；預設兩個網址都驗；收錄斷言跟 `ALLOW_INDEXING` 走（0 要有 noindex、1 要沒有）；驗 lemibox.com 時加驗 www 與 http 轉址；先等新版本生效再驗 | `scripts/deploy.sh --smoke-only` 兩個網址全過 |
| 寫死網址 | MusicBrainz、維基共享資源腳本的 User-Agent 改 `https://lemibox.com`；`viewer.ts` 的 `siteOrigin()` 本來就照請求 host 算，只改註解 | og:url 在新網域自動變 `https://lemibox.com/…` |

## 驗收（`_驗收_正式站.py`）

第一輪（`驗收輸出_第1輪.txt`）49/53，第二輪（`驗收輸出_第2輪.txt`）39/39。第一輪 4 項失敗的處理：

- http 沒轉 https（200）：真問題，`a7a01330` 修掉，第二輪通過
- 大圖網址沒登入 401：設計如此（`app/img` 大圖要登入），改成驗縮圖沒登入 200＋大圖沒登入 401
- 兩項 console error：全是 Turnstile 小框自己的 `%c%d font-size:0…`（來源 `challenges.cloudflare.com`），舊網址 `/login` 一樣有，排除後 0

公開頁（本機無頭 Chromium，1440／390／360 三種寬度）：首頁、藝人目錄、藝人頁、收藏頁 `/share/4`、查證頁、登入、註冊、意見回饋全部 200、網址留在 lemibox.com、手機無橫向溢出、og:url 為新網域；收藏頁照片全部載入，og 預覽圖與縮圖 200。

帳號與上傳（Windows Chrome，受管理模式的 Turnstile 要真瀏覽器，在 lemibox.com 上實際點表單）：

| 步驟 | 結果 |
|---|---|
| 註冊 `zukawork0312+lemibox0930@gmail.com`／帳號 `lmbtest0930` | 201，進驗證碼畫面 |
| 驗證信 | Resend `01a0f247-a820-779d-a6ae-9313f6d33279`，寄件人 `樂迷藏 <noreply@notify.dblzm.com>`，**last_event=delivered** |
| 驗證後登入 | `/api/me` 回帳號；cookie `yz_session` 發在 lemibox.com、HttpOnly、Secure、Lax |
| 登出、再登入 | 通過 |
| 忘記密碼信 | Resend `01a0f248-10a8-75b8-92b8-945d7593cdb3`，**last_event=delivered** |
| 重設密碼並登入 | 通過；舊密碼＋假 token 回 400 |
| 上傳照片 | 查證碼 `5BMMZ`，瀏覽器燒好浮水印（`img/新上傳照片_縮圖_燒浮水印.webp`） |
| 發布收藏 | 201，`/share/7`；照片載入、`/verify?c=5BMMZ` 查得到、390px 無溢出 |

截圖在 `img/`（JPEG 品質 80）。「delivered」是 Resend 回報 Gmail 收件伺服器已收下，進收件匣還是垃圾信要到信箱看。

## 正式站留下的測試資料（待使用者決定刪不刪）

- 會員 `lmbtest0930`（Email `zukawork0312+lemibox0930@gmail.com`）與其 session
- 收藏 `/share/7`（落日飛車，內文「正式網域驗收測試，驗完會刪」），**目前公開看得到**
- 照片 `P4HNEJQCAj-OIlIT`（R2 主圖、縮圖、預覽圖、`o/` 原圖）

## 沒做、建議

- **lemicang.com：未購買**。帳號裡只有 lemibox.com 一個 zone；Verisign RDAP 查 `lemicang.com` 回 404（全球查無註冊）。金鑰沒有 Registrar 權限，註冊商清單讀不到，但 Cloudflare 買的網域一定會有 zone，所以判定未購買
- **workers.dev 舊網址轉址**（只建議，沒動）：開放收錄前一定要處理，不然兩個 host 同時被收錄。做法：`worker.ts` 對 `yinzang.dblzm.workers.dev` 的 GET 回 301 到 lemibox.com（API 與登入中的會員要一起想：舊網址的 cookie 帶不過去，會員要在新網址重新登入）；同時把 `siteOrigin()` 改成固定回 `https://lemibox.com` 當 canonical。時機建議跟開放收錄一起
- **Always Use HTTPS／Redirect Rules**：目前靠 Worker 轉址，功能已經正常。想改回用 Cloudflare 規則，金鑰要補 Zone「Zone Settings：Edit」與「Single Redirect／Dynamic Redirect（Rulesets）：Edit」，非必要
- 金鑰目前**沒有** DNS 讀寫權限；綁 Custom Domain 不需要，這次也沒用到。之後要在 lemibox.com 加寄件子網域或其他紀錄，要補「Zone／DNS：Edit」
