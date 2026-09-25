# pm-music 記憶索引

> 專案事實、決策、待討論一律寫 `00_現況.md`，這裡只記「怎麼跟這個專案工作」的偏好與踩坑。
> Codex 端寫入的行結尾標 ` [Codex]`。

## 偏好與踩坑
- vinext 下 client component 用 `useId()` 會 hydration 不一致（伺服器與瀏覽器 id 不同），單頁唯一的表單直接寫死 id（2026-09-25）
- 驗收用 Playwright 跑 `networkidle`＋`document.fonts.ready`，互動狀態要等 `aria-pressed` 出現才點，否則 localStorage 還沒讀進來（2026-09-25）
