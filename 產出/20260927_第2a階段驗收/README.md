# 第 2a 階段驗收：帳號、D1、API、狀態搬家

2026-09-27，Claude Code on Windows。全程本機（vinext dev＋Miniflare 模擬 D1），雲端沒有建立任何東西。
設計文件：`產出/20260927_第2階段技術設計.md`。

## 結果

| 項目 | 結果 |
|---|---|
| 主腳本 `_驗收.py` | **36/36** |
| Turnstile 真的失敗（失敗密鑰冷啟動）`_驗收_turnstile失敗.py` | 1/1 |
| 沒搬的功能照舊能動 `_驗收_未搬功能.py` | 6/6 |
| tsc | 0 錯 |
| lint | 0 錯（1 個警告是既有的 layout 字型警告，本輪沒動） |
| 截圖 | 44 個畫面（訪客／登入 × 1440／390 × 11 頁，加登入面板）無橫向溢出、console error 0 |

逐條結果在 `result.json`，截圖在 `img/`（JPEG 80）。

### 逐條

**A 遷移**
- 空資料庫（暫存資料夾）`wrangler d1 migrations apply --local`：`0000_account.sql` ✅，15 條指令成功
- 再跑一次：`No migrations to apply!`
- 空資料庫套完遷移 users 0 列：遷移只有結構，沒有示範資料。建出的表：users、sessions、email_codes、rate_limits、likes、holdings、follows（另有 wrangler 自己的 d1_migrations）

**B 完整流程（Playwright）**：註冊 → 驗證碼從 dev server 終端機輸出抓（例 `636347`）→ 驗證後直接登入 → 登出 → 登入 → 單則頁點讚（讚數 +1）、藝人頁追蹤、版本「我有」→ 重新整理三項都在 → 個人頁列出追蹤與我有、喜愛清單有這則 → **另開一個瀏覽器 context** 從 `/login?next=` 登入同帳號，回到原頁，三項都在

**C 未登入點讚**（390 寬）：`/share/2` 按愛心 → 彈出面板「登入後才能點讚」，網址沒變 → 面板裡登入 → 面板關掉、留在 `/share/2`、愛心亮起 → 重新整理仍亮

**D App 路徑（Bearer）**
```
POST /api/auth/login {"email":…, "password":…, "turnstileToken":…, "client":"app"}  → 200，body 帶 token，不發 cookie
curl -H "Authorization: Bearer <token>" http://localhost:5173/api/me/state
→ {"liked":[1,2],"owned":["mountain-radio/1#cd-v1"],"wanted":[],"follows":["mountain-radio"]}
```
- Bearer 寫入追蹤成功；不帶 token 401 `UNAUTHENTICATED`
- 拿 cookie 打寫入端點但沒有同站 Origin → 403 `BAD_ORIGIN`（CSRF 擋下）
- `GET /api/users/{帳號}` 只回名稱、簡介、認證、我有／想要，追蹤與點讚不外露

**E 錯誤情境**
- 錯密碼：畫面「Email 或密碼不對」
- 未驗證 Email 登入：擋下，自動寄碼，面板切到驗證碼步驟「這個 Email 還沒驗證」
- 重複註冊：畫面「這個 Email 已經註冊過，直接登入就好」；帳號名重複 409 `HANDLE_TAKEN`
- Turnstile：沒 token → 400 `TURNSTILE_FAILED`；用失敗密鑰 `2x0000000000000000000000000000000AA` 冷啟動後，畫面登入顯示「機器人驗證沒過，重新整理再試一次」且沒登入（`img/登入頁_Turnstile失敗_1440.jpg`）
- 驗證碼錯：400 `CODE_INVALID`
- 忘記密碼：寄重設碼 → 重設成功 → 舊 token 401 → 新密碼可登入

**G 沒搬的功能**（示範帳號阿澤登入）：出價送出後進私訊、出價訊息在；私訊打字；檢舉示範表單；「清掉追蹤」改走 API 後首頁出現熱門藝人；這段 console error 0

## 重跑

```
cd 網站 && npm ci
npm run db:migrate:local && npm run db:seed:local
npm run dev > dev.log 2>&1 &          # 驗證碼印在這個輸出
cd ../產出/20260927_第2a階段驗收
python3 _驗收.py ../../網站/dev.log   # 每次用新的 Email，不用清資料庫
python3 _驗收_未搬功能.py
# Turnstile 失敗：TURNSTILE_SECRET=2x0000000000000000000000000000000AA npm run dev 冷啟動後
python3 _驗收_turnstile失敗.py
```

## 已知問題與取捨

1. **讚數、我有／想要人數還是示範數字＋自己那一票**。內容（炫收藏、版本）還在 `lib/data.ts`，別的真實帳號按的讚不會算進公開數字。2b 內容進 D1 後改成資料庫計數
2. **兩種身分並存**：點讚、我有、想要、追蹤跟著登入帳號走（D1）；炫收藏發布、出價、私訊、檢舉、申訴、後台還是示範身分「小孟」，存在 localStorage，不管登入誰都一樣。2b 一起搬。頭像選單的「檢舉示範身分」段就是這個示範切換，暫時保留
3. **內容識別碼只檢查格式**：API 收到 `share: 99999` 或不存在的版本鍵也會存。內容表 2b 才進 D1，那時再加存在檢查。刻意不設外鍵，理由見設計文件第三節
4. **訪客首頁看不到小孟的示範追蹤了**：以前沒登入也預設是小孟的狀態，現在訪客就是訪客，首頁「追蹤中」落回熱門藝人＋最新。想看有追蹤的樣子，用示範帳號登入（`xiaomeng@demo.yinzang.test`／`yinzang-demo`）
5. **瀏覽器舊的 localStorage 點讚／我有／追蹤不搬進 D1**：那是示範資料，讀到直接丟掉；出售、私訊等其餘本機資料照留
6. **寄信只有 console**：「本機檔」做不到，Worker（workerd）裡沒有檔案系統；驗證碼印在 dev server 的輸出，要存檔就把輸出導到檔案（驗收就是這樣抓的）。正式寄信服務要使用者先註冊，見設計文件第十一節
7. **PBKDF2 只有 100,000 次**：Workers 的硬上限，低於 OWASP 建議。另外免費方案每次請求 CPU 10ms，登入／註冊可能超過，2c 部署後實測，超過就降次數。本機不會出現這個問題
8. **Email 是否已註冊會被看出來**：註冊時直接告訴使用者「已經註冊過」，體驗比較好，代價是可以拿來試 Email 在不在。靠 Turnstile＋每 IP 每小時 10 次註冊擋批量。登入與忘記密碼不透露
9. **畫面一開頭不知道登入狀態**：伺服器渲染時不查 session，頁面出來後打一次 `/api/me` 才知道。這一瞬間頭像位置是灰色方塊、愛心是空的（`aria-pressed` 也還沒出現）。好處是頁面不用每次都查資料庫、可以快取
10. **Turnstile 測試小框有紅字「僅用於測試」**：那是 Cloudflare 測試金鑰自己帶的提示，正式金鑰不會出現
11. **有 Turnstile 小框的頁面 networkidle 等不到**：iframe 會一直連線。驗收腳本改成最多等 8 秒，不影響使用者
12. **過期的 session、驗證碼、頻率計數列不會自動刪**：量很小，2c 排程清
13. **管理後台任何人都進得去**：跟前一輪一樣，權限 2b 接（`users.role` 已經有欄位）
14. **本機示範帳號阿凱（kai）是未驗證 Email**：登入會被要求輸入驗證碼，碼在 dev server 輸出，這是刻意保留的示範
15. **dev server 冷啟動過兩次**：換 vite 設定（D1 綁定、環境變數）與測 Turnstile 失敗密鑰。5173 那支原本就是這個工作階段起的，已換成新的一支繼續跑
