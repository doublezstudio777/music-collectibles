// 意見回饋（2026-09-29）：前後端共用的類型與上限。
export const FEEDBACK_KINDS = [
  { key: "suggest", label: "功能建議" },
  { key: "data", label: "資料錯誤" },
  { key: "partner", label: "合作洽詢" },
  { key: "privacy", label: "隱私權申請" },
  { key: "takedown", label: "照片撤下申請" },
  { key: "other", label: "其他" },
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["key"];
export const FEEDBACK_LABEL = Object.fromEntries(FEEDBACK_KINDS.map((k) => [k.key, k.label])) as Record<FeedbackKind, string>;
export const isFeedbackKind = (v: unknown): v is FeedbackKind => typeof v === "string" && FEEDBACK_KINDS.some((k) => k.key === v);
/** 內容上限（字，以 Unicode 字元算） */
export const FEEDBACK_MAX = 2000;
/** 每個 IP 每小時幾則 */
export const FEEDBACK_PER_HOUR = 5;
/** 法務頁連過來預選類型：/feedback?type=privacy */
export const feedbackHref = (kind?: FeedbackKind) => (kind ? `/feedback?type=${kind}` : "/feedback");
