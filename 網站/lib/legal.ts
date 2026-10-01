// 法務頁共用常數（2026-10-01 法務修正，依 產出/20261001_上線前法務審閱/）。前後端都會 import，不能碰伺服器模組。
//
// 改條款或隱私權政策內容時：TERMS_VERSION 加一（1.0 → 1.1）、改 TERMS_EFFECTIVE，TERMS_HISTORY 補一列，
// 舊版全文另存一份可查（/terms/history）。
// 要不要強制重新同意看 TERMS_REQUIRED（2026-10-01 使用者決定）：
// - 補充揭露的小版本（1.1 補 Google Analytics）只改 TERMS_VERSION、在網站公告（TERMS_NOTICE），不改 TERMS_REQUIRED，
//   會員不用重按同意、照常發文出價；條款第 18 條「生效後繼續使用視為同意」
// - 重大變更（影響權益、要本人另外同意的）才把 TERMS_REQUIRED 改成新版號，所有會員下次登入跳補同意視窗、同意前不能發布出價投稿

/** 現行使用條款與隱私權政策版本（兩份一起算一個版本） */
export const TERMS_VERSION = "1.1";
/** 生效日（1.1：2026-10-01 公告，照政策「生效前至少 7 日公告」，10-08 生效） */
export const TERMS_EFFECTIVE = "2026-10-08";
/** 會員至少要同意到這一版才能發布、出價、投稿（強制重新同意的最低版本） */
export const TERMS_REQUIRED = "1.0";

const ver = (v: string) => v.split(".").map((x) => Number(x) || 0);
/** 會員同意過的版本 ≥ TERMS_REQUIRED（沒同意過任何版本是 false） */
export function termsAccepted(version: string | null | undefined) {
  if (!version) return false;
  const [a, b] = [ver(version), ver(TERMS_REQUIRED)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** 網站公告的條款更新（小版本不強制同意，只公告）。null＝目前沒有要公告的 */
export const TERMS_NOTICE: { version: string; announced: string; effective: string; text: string; href: string } | null = {
  version: "1.1",
  announced: "2026-10-01",
  effective: "2026-10-08",
  text: "隱私權政策更新：補上 Google Analytics 使用情形統計的說明（用途、Cookie、怎麼停用）",
  href: "/privacy",
};

/** 歷史版本（新的在前）。href 是該版全文的位置；現行版就是 /terms、/privacy */
export const TERMS_HISTORY: { version: string; effective: string; note: string; terms: string; privacy: string }[] = [
  { version: "1.1", effective: TERMS_EFFECTIVE, note: "2026-10-01 公告。隱私權政策補上 Google Analytics（統計使用情形、Cookie、怎麼停用）、Spotify 嵌入播放器也用在藝人頁；使用條款內容沒有改。補充揭露，不用重新同意", terms: "/terms", privacy: "/privacy" },
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
