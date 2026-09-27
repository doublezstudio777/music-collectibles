// 等級（2026-09-28）：五個稱號各分 Lv.1～5，共 25 級。前後端共用，只放純函式與常數。
// 門檻的設計理由與換算見 產出/20260928_等級與稱號/README.md 最前面的表。

export const TIERS = ["新晉樂迷", "專業樂迷", "資深樂迷", "收藏家", "典藏家"] as const;

/** 第 i 級（0 起算）需要的累計分數。LEVELS[0]＝新晉樂迷 Lv.1＝0 分；LEVELS[24]＝典藏家 Lv.5 */
export const LEVELS = [
  0, 30, 70, 130, 200, // 新晉樂迷
  300, 390, 500, 650, 840, // 專業樂迷
  1100, 1400, 1800, 2400, 3000, // 資深樂迷
  3900, 5100, 6600, 8500, 11000, // 收藏家
  14000, 18000, 24000, 31000, 40000, // 典藏家
] as const;

/** 管理員名單裡的帳號固定顯示 */
export const CURATOR = "館長";

export type LevelInfo = {
  /** 1～25 */
  level: number;
  tier: (typeof TIERS)[number];
  /** 1～5 */
  lv: number;
  label: string;
  /** 下一級要幾分；已經最高級是 null */
  next: number | null;
  /** 離下一級還差幾分 */
  toNext: number;
};

export function levelOf(score: number): LevelInfo {
  const s = Math.max(0, Math.floor(score));
  let i = 0;
  while (i + 1 < LEVELS.length && s >= LEVELS[i + 1]) i++;
  const tier = TIERS[Math.floor(i / 5)];
  const lv = (i % 5) + 1;
  const next = i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
  return { level: i + 1, tier, lv, label: `${tier} Lv.${lv}`, next, toNext: next === null ? 0 : next - s };
}

/** 暱稱旁的小標籤文字 */
export const badgeText = (score: number, admin: boolean) => (admin ? CURATOR : levelOf(score).label);
