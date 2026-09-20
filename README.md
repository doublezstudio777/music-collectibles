# music-collectibles

台灣樂團／獨立歌手專輯與周邊的 C2C 收藏交易平台。自研專案。

進度看 **[`00_現況.md`](00_現況.md)**。

## 結構

```
.codex/config.toml   Codex 設定（模型、reasoning），跟著 git 跨機同步
_共用規則.md          兩個 AI 都適用的規則
AGENTS.md            Codex 讀
CLAUDE.md            Claude Code 讀
00_現況.md            接力棒：誰做到哪、下一步
討論/                 AI 對話存檔
研究/                 競品、市場、法規（附來源）
產出/                 企劃書、規格、簡報
```

## 各裝置怎麼接上

**Mac — Codex app**
1. 新增專案 → 選這個資料夾
2. 說「讀 AGENTS.md 和 00_現況.md，開始」
3. `.codex/config.toml` 會自動套用

**Windows — Codex app**（Microsoft Store 版，不是終端機 CLI）
1. `git clone git@github.com:doublezstudio777/music-collectibles.git`
2. 同上開成專案

**Windows／Mac — Claude Code**
1. `cd` 進這個資料夾，`CLAUDE.md` 自動載入

**手機** — GitHub app 看 markdown，唯讀為主。

## 鐵則

- 開工 `git pull`，收工 `git push`。沒 push 等於沒做
- **這個 repo 不要放進 OneDrive**，`.git` 會被同步機制弄壞
