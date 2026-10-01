// 法務頁共用常數（2026-10-01 法務修正，依 產出/20261001_上線前法務審閱/）。前後端都會 import，不能碰伺服器模組。
//
// 改條款或隱私權政策內容時：TERMS_VERSION 加一（1.0 → 1.1）、改 TERMS_EFFECTIVE，TERMS_HISTORY 補一列，
// 舊版全文另存一份可查（/terms/history）。版本號一變，所有會員下次登入都會跳補同意視窗。

/** 現行使用條款與隱私權政策版本（兩份一起算一個版本） */
export const TERMS_VERSION = "1.1";
/** 生效日 */
export const TERMS_EFFECTIVE = "2026-10-01";

/** 歷史版本（新的在前）。href 是該版全文的位置；現行版就是 /terms、/privacy */
export const TERMS_HISTORY: { version: string; effective: string; note: string; terms: string; privacy: string }[] = [
  { version: "1.1", effective: TERMS_EFFECTIVE, note: "隱私權政策補上 Google Analytics（統計使用情形、Cookie、怎麼停用）；使用條款內容沒有改", terms: "/terms", privacy: "/privacy" },
  { version: "1.0", effective: "2026-10-01", note: "第一個生效的版本", terms: "/terms", privacy: "/privacy/v1-0" },
];

/** 經營者（個資法第 8 條應告知事項第一款；用戶 2026-10-01 決定） */
export const OPERATOR = {
  name: "達帛利數位行銷工作室",
  taxId: "91133660",
  owner: "陳應銓",
  place: "新竹縣",
} as const;

/** 經營者一句話：用在條款與隱私權政策開頭 */
export const OPERATOR_TEXT = `${OPERATOR.name}（統一編號 ${OPERATOR.taxId}，負責人${OPERATOR.owner}，${OPERATOR.place}）`;

/** 聯絡信箱：隱私權申請、侵權通知的聯繫窗口（信箱由用戶在 Cloudflare Email Routing 轉寄） */
export const CONTACT_EMAIL = "service@lemibox.com";

/** 權利侵害通知頁 */
export const TAKEDOWN_PATH = "/takedown";

/** 刪帳申請處理期限（個資法第 13 條第 2 項：30 日，必要時延長 30 日） */
export const DELETION_DAYS = 30;

/** 轉送回復通知後，通知人要在幾個工作日內提出起訴證明（著作權法第 90 條之 10） */
export const RESTORE_WORKDAYS = 10;
/** 第幾次確認侵權就終止服務 */
export const STRIKE_LIMIT = 3;
