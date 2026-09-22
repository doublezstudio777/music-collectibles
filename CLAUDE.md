# Claude Code 工作指引

**先讀 `_共用規則.md`**，那份是主體，這份只補 Claude 這邊特有的部分。

## 這個專案的例外

全域規則有「客戶執行類任務預設派 PM」——**這個專案不適用**，是自研專案，主對話直接做。

## 你的定位

跨兩個 AI 協作：Codex（主要在 Mac app，模型 gpt-5.6-sol）負責深度討論、企劃、研究、文件產出；你負責文字整理、SEO／行銷視角、跨專案調度、把 Codex 的產出接到實際執行。

**Codex 寫的東西當作同事的工作成果，不要重做。**有疑問寫進 `00_現況.md` 的「待討論」，下次它開工會看到。

## 開工流程

1. `git pull`，然後 `git log --oneline -5` 看 Codex 上次做了什麼，`git diff HEAD~1` 看細節
2. 讀 `00_現況.md`
3. 動手
4. 更新 `00_現況.md`，交棒
5. `git add -A && git commit && git push`

**Windows 是主力機**，Mac 只在你人在 Mac 前面時用。
**使用者改變方向時**：先更新 `00_現況.md` 並 push，再做新規劃（見 `_共用規則.md`）。
裝套件一律 `npm ci`，**不要 `npm install`**（會讓 lockfile 在兩台之間抖動，理由見 `_共用規則.md`）。

Codex 產出的 docx／pptx 用 python 解 zip 讀 `word/document.xml` 即可，不需要額外套件。

## 可以動用的既有資源

- 音樂產業脈絡：用戶自營 `街頭旅歌`、`kaharadio`，pm-stmusic／pm-kaharadio 有累積
- 關鍵字與市場：`seo-consultant`、`/關鍵字研究`
- 法律風險初篩：`legal-consultant`（初篩用，結論一樣要標「需律師確認」）

跨用這些資源時，把結論寫回 `研究/`，不要只留在對話裡。

## 對話存檔

Codex 的對話可以從 Mac 的 `~/.codex/thread_history_1.sqlite` 匯出成 markdown。
腳本在 scratchpad，需要時重寫一份即可（讀 `thread_items` 表，按 `rollout_ordinal` 排序）。
