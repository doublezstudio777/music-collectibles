# 關於頁＋首頁標語（2026-09-28）

用戶已核准文字與上線。

## 做了什麼

1. **新頁 `/about`**（`app/about/page.tsx`）：標題「關於樂迷藏」，正文逐字照抄用戶提供的四段文字（一字未改），最後一行「樂迷藏站長」靠右。站名全部讀 `SITE_NAME`，改名會跟著變。og:title 用「關於{SITE_NAME}」、og:description 用第一段全文。加進 `worker.ts` 的 `CACHEABLE` 白名單，整頁快取生效（正式站驗到 `x-yz-cache: HIT`／`cf-cache-status: HIT`）。
2. **頁尾**（`app/layout.tsx`）：「隱私權政策」「使用條款」前面加「關於{SITE_NAME}」連結。
3. **首頁標語**（`components/home-tagline.tsx`，掛在 `app/page.tsx`）：「別讓一張專輯的來歷，只有少數人知道。」＋「關於我們」連結到 `/about`。
   - 只給訪客看：用既有的 `useAccount()`（`/api/me`）判斷登入狀態
   - 節點永遠渲染、佔位永遠不變，只切換 `opacity`（`data-visible` 屬性驅動 CSS）：伺服器輸出與 hydration 第一次都是 `data-visible="false"`（狀態預設 `loading`），確認是訪客後才淡入；確認是登入者則永遠維持隱藏，不會有「先顯示後收回」的閃爍
   - 首頁本身仍是同一份快取 HTML（`/` 在白名單裡沒變動），不影響快取命中

## 驗收結果

**本機（dev，`localhost:5173`）**：自寫驗收腳本 22/22 all pass，涵蓋：
- 訪客確認後 `data-visible=true`／`opacity=1`，文字與連結正確
- 訪客 DOM 剛掛載時預設隱藏（證明不是登入者畫面先出現再收回）
- 登入者（管理員帳號）全程輪詢 9 次都是 `data-visible=false`，最終 `opacity=0`（無閃一下）
- 320／390／1440 三寬度 × `/`、`/about` 六張截圖：無水平溢出、console error 0

**本機（build，`127.0.0.1:8791`）**：
- `/about` 正文逐段跟原文字比對，完全一致（`about.html` 抓 `<p>` 純文字逐句核對）
- 沿用「20260928_手機版切版修正」的 `_檢查.py`，加入 `/about`，9 個寬度（320～1440）× 4 頁（含新的 about、home）掃描：**home、about 兩頁全部寬度 0 個發現、0 個 console error**（唯一的發現在 `share/1` 頁 1024／1440 寬度的 `.prose` 左邊界檢測，跟本次改動的檔案無關，屬於既有版面、非本次改動觸發）
- 沿用「其他系列與評論區」`_驗收_本機.py`：頁尾「找不到贊助」「有版權聲明」在 `/`、`/artists`、`/artist/*`、`/share/*`、`/login`、`/search`、`/tag/*`、`/u/*` 全部通過，證明加了「關於樂迷藏」連結後頁尾其餘元素沒壞。後段留言相關的一項既有 FAIL（`2h`）與腳本自身測試資料累積有關（`PM記憶/log` 已知限制），跟本次改動無關
- `tsc --noEmit` 0 錯；`eslint` 0 錯（1 個跟本次改動無關的既有 `no-page-custom-font` 警告）

**正式站**（`https://yinzang.dblzm.workers.dev`，`scripts/deploy.sh` 完整跑過，含遷移檢查、建置、部署前站外備份、部署、curl 煙霧測試、Playwright 瀏覽器煙霧測試，全部通過）：
- `/about` 200，正文與署名字元核對正確；`/about` 出現 `x-yz-cache: HIT`（整頁快取生效）
- 首頁頁尾新增「關於樂迷藏」連結正常
- 連續瀏覽 100 次首頁（帶瀏覽器 UA，因為 Cloudflare 會擋掉沒有 UA 的自動化請求）：**200×100，503×0**

## 檔案

- `網站/app/about/page.tsx`（新增）
- `網站/components/home-tagline.tsx`（新增）
- `網站/app/page.tsx`、`網站/app/layout.tsx`、`網站/app/globals.css`、`網站/worker.ts`（修改）

## 部署

`scripts/deploy.sh`，Current Version ID `1e1b6554-2496-4ce1-95c8-229a6b735eda`。
