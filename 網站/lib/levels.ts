// 等級（2026-09-28 定案降低版）：五個稱號各分 Lv.1～5，共 25 級。管理員可以指定某人的等級（override，1～25）。前後端共用，只放純函式與常數。
// 門檻的設計理由與換算見 產出/20260928_等級與稱號/README.md 最前面的表。

export const TIERS = ["新晉樂迷", "專業樂迷", "資深樂迷", "收藏家", "典藏家"] as const;

/** 第 i 級（0 起算）需要的累計分數。LEVELS[0]＝新晉樂迷 Lv.1＝0 分；LEVELS[24]＝典藏家 Lv.5 */
export const LEVELS = [
  0, 20, 50, 90, 140, // 新晉樂迷
  200, 280, 380, 500, 650, // 專業樂迷
  800, 1000, 1250, 1550, 1900, // 資深樂迷
  2300, 2800, 3400, 4100, 5000, // 收藏家
  6000, 7200, 8600, 10200, 12000, // 典藏家
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

/**
 * 分數換等級。override＝管理員指定的等級（1～25），有的話顯示指定的等級，分數照常累計；
 * 離下一級＝指定等級的下一級門檻減目前分數，分數已超過就不顯示（next 為 null）
 */
export function levelOf(score: number, override?: number | null): LevelInfo {
  const s = Math.max(0, Math.floor(score));
  let i = 0;
  if (override && override >= 1 && override <= LEVELS.length) i = override - 1;
  else while (i + 1 < LEVELS.length && s >= LEVELS[i + 1]) i++;
  const tier = TIERS[Math.floor(i / 5)];
  const lv = (i % 5) + 1;
  let next: number | null = i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
  if (next !== null && next <= s) next = null;
  return { level: i + 1, tier, lv, label: `${tier} Lv.${lv}`, next, toNext: next === null ? 0 : next - s };
}

/** 第 level 級（1～25）的名稱 */
export const levelLabel = (level: number) => `${TIERS[Math.floor((level - 1) / 5)]} Lv.${((level - 1) % 5) + 1}`;

/** 暱稱旁的小標籤文字 */
export const badgeText = (score: number, admin: boolean, override?: number | null) => (admin ? CURATOR : levelOf(score, override).label);
