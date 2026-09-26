// 歷史價格：純函式（不碰資料庫），伺服器與驗收共用。
//
// 規則（2026-09-27 定案，方法寫在 產出/20260927_第2階段技術設計.md 第十九節）：
// - 只算買賣雙方都是認證帳號（已驗證 Email）的成交；作廢（賣家改回出售中）的不算
// - 近期＝最近 365 天，最多取最新 20 筆
// - 同一對買賣家（賣家→買家）在同一版本重複成交只算一次，留最新那筆
// - 排除離群值：價格不在中位數的 1/3～3 倍之間的排除；剩 5 筆以上時，再用 MAD（修正 z 分數 > 3.5）排除
// - 排除後不足 3 筆 → 整塊不顯示（回 null）
// - 不回傳買賣雙方是誰

export type DealPoint = { price: number; soldAt: string; sellerId: string; buyerId: string };
export type PriceSummary = {
  n: number;
  min: number;
  max: number;
  median: number;
  /** 舊到新 */
  points: { date: string; price: number }[];
  /** 被排除的離群值筆數 */
  excluded: number;
  asks: [number, number] | null;
  bids: [number, number] | null;
};

export const RECENT_DAYS = 365;
export const RECENT_MAX = 20;
export const MIN_DEALS = 3;

export const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

/** 回傳保留的與排除的 */
export function dropOutliers<T extends { price: number }>(list: T[]) {
  if (list.length === 0) return { kept: list, excluded: [] as T[] };
  const med = median(list.map((d) => d.price));
  let kept = list.filter((d) => d.price >= med / 3 && d.price <= med * 3);
  if (kept.length >= 5) {
    const m2 = median(kept.map((d) => d.price));
    const mad = median(kept.map((d) => Math.abs(d.price - m2)));
    if (mad > 0) kept = kept.filter((d) => Math.abs((0.6745 * (d.price - m2)) / mad) <= 3.5);
  }
  return { kept, excluded: list.filter((d) => !kept.includes(d)) };
}

const range = (xs: number[]): [number, number] | null => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null);

export function summarize(deals: DealPoint[], asks: number[], bids: number[], nowMs = Date.now()): PriceSummary | null {
  const since = nowMs - RECENT_DAYS * 86400_000;
  const recent = deals
    .filter((d) => Date.parse(d.soldAt) >= since)
    .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));
  const seen = new Set<string>();
  const unique = recent.filter((d) => {
    const k = `${d.sellerId}>${d.buyerId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const latest = unique.slice(0, RECENT_MAX);
  const { kept, excluded } = dropOutliers(latest);
  if (kept.length < MIN_DEALS) return null;
  const prices = kept.map((d) => d.price);
  return {
    n: kept.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    median: median(prices),
    points: [...kept].reverse().map((d) => ({ date: d.soldAt.slice(0, 10), price: d.price })),
    excluded: excluded.length,
    asks: range(asks),
    bids: range(bids),
  };
}
