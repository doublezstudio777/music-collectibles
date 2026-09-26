# pm-music 記憶索引

> 專案事實、決策、待討論一律寫 `00_現況.md`，這裡只記「怎麼跟這個專案工作」的偏好與踩坑。
> Codex 端寫入的行結尾標 ` [Codex]`。

## 偏好與踩坑
- vinext 下 client component 用 `useId()` 會 hydration 不一致（伺服器與瀏覽器 id 不同），單頁唯一的表單直接寫死 id（2026-09-25）
- 驗收用 Playwright 跑 `networkidle`＋`document.fonts.ready`，互動狀態要等 `aria-pressed` 出現才點，否則 localStorage 還沒讀進來（2026-09-25）
- 已售出封面用 opacity 淡化，headless 截圖會出現一塊內框假影（合成圖層切塊）；改用 `color-mix` 算淡色背景，照片才用 opacity（2026-09-26）
- 驗收截圖存 JPEG 品質 80（用戶 9/26 嫌上次 PNG 14MB 太大），驗收腳本留在驗收資料夾可重跑（2026-09-26）
- 修正輪不用重跑整套驗收清單，只挑受影響頁面重驗；沒改到的頁面沿用上一輪驗收結果，README 註明清楚即可（2026-09-26）
- 公開列表要「同一人只留最新一筆」時，改 flatMap 抓每條 thread 的最後一則訊息即可，不用改資料層，訊息歷史仍完整保留給私訊頁（2026-09-26）
- 大改資料結構時先整段重寫資料區塊再用 regex 批次換鍵（版本鍵、連結），比逐處 patch 快；驗收腳本用新 context 跑，不碰使用者 localStorage（2026-09-26）
- PM 在 repo 施工期間，主對話只 `git add` 指定檔案，禁 `git add -A`（2026-09-26 主對話兩筆 commit 誤夾 PM 未完成的網站程式碼）
