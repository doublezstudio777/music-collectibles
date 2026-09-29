// 計分常數（2026-09-29 從 lib/server/scores.ts 搬出來）：前後端共用。
// 新手指南（/guide）的得分表直接從這裡產生，規則改了指南跟著變，不手打數字。

export const POINTS = {
  edit: 20,
  editBig: 30,
  create: 15,
  share: 10,
  fill: 10,
  likeRecv: 1,
  likeGive: 1,
  comment: 2,
  commentRecv: 1,
  deal: 5,
  reportOk: 10,
  reportBad: -5,
} as const;

export const CAPS = {
  shareDay: 5,
  fillDay: 5,
  commentDay: 10,
  likeGiveDay: 10,
  likeRecvPerShare: 50,
  commentRecvPerShare: 50,
  pairLikes: 20,
  pairComments: 10,
  pairDeals: 2,
} as const;

/** 改動不到這麼多字＝極小修改 */
export const MINOR_CHARS = 10;
/** 改動這麼多字以上＝大幅編輯 */
export const BIG_CHARS = 200;
/** 同一人同一頁連續編輯合併的間隔 */
export const SESSION_MINUTES = 60;
/** 編輯、補資料、檢舉成立的入帳等待期 */
export const HOLD_DAYS = 7;
export const TITLE_FAKEBUSTER_MIN = 5;
