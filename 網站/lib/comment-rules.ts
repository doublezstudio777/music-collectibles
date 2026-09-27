// 留言規則（前後端共用，2026-09-28）。
// 只放純函式：字數上限、站外交易字眼偵測。偵測到只提醒，不擋送出。

export const COMMENT_MAX = 500;
/** 每個帳號每分鐘、每天最多幾則 */
export const COMMENT_PER_MINUTE = 3;
export const COMMENT_PER_DAY = 50;
/** 被幾個人檢舉就自動隱藏（後台可調，存 settings.comment_report_threshold） */
export const DEFAULT_COMMENT_THRESHOLD = 3;

export const COMMENT_REASONS = [
  { key: "scam", label: "詐騙或站外交易" },
  { key: "abuse", label: "騷擾、不當言論" },
  { key: "other", label: "其他" },
] as const;
export type CommentReason = (typeof COMMENT_REASONS)[number]["key"];
export const commentReasonLabel = (k: string) => COMMENT_REASONS.find((r) => r.key === k)?.label ?? k;

/** 字數用字元算（emoji、中文都算一個字），不用 UTF-16 長度 */
export const charCount = (s: string) => Array.from(s).length;

// 站外交易常見字眼：外部連結、LINE／其他通訊軟體帳號、匯款轉帳
const PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /www\./i,
  /[a-z0-9-]+\.(?:com|net|org|tw|cc|me|io|co|shop|xyz|top|cn|hk|ly|link|site|app)\b/i,
  /line\s*id/i,
  /(?:^|[^a-z])line\s*[:：@]/i,
  /加\s*(?:line|賴|我\s*賴|好友)/i,
  /賴\s*[:：@]/,
  /(?:^|\s)@[a-z0-9._-]{4,}/i,
  /微信|wechat|telegram|whatsapp|\btg\s*[:：]/i,
  /私下|匯款|轉帳|無卡存款|代碼繳費|先付款|先匯/,
];

/** 有沒有站外交易字眼（只拿來顯示「小心站外交易詐騙」） */
export const looksOffsite = (text: string) => PATTERNS.some((p) => p.test(text));

/** 存進資料庫前的整理：拿掉控制字元（保留換行），行尾空白、連續超過兩個空行壓成兩個 */
export function cleanComment(raw: string) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
