// 私訊防騷擾的共用規則（前後端都用，2026-10-01）

export const DEFAULT_DM_DAILY_LIMIT = 10;
export const DM_REPORT_REASONS = ["harass", "scam", "spam", "other"] as const;
export const DM_REASON_LABEL: Record<string, string> = { harass: "騷擾", scam: "詐騙", spam: "廣告洗版", other: "其他" };
