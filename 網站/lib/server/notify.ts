// 會員通知信（2026-10-02 總檢 M2）：使用條款第 12 條第 3 項承諾「你的內容或帳號被處理時，我們會通知你並說明原因」。
//
// 哪些情況會寄：
// - 收藏檢舉達門檻自動鎖定（moderation.ts report）
// - 管理員隱藏收藏（takedown.ts setHidden）、刪除或自動隱藏留言（comments.ts）、移除大頭貼（avatars.ts）
// - 停權與恢復（members.ts）
// - 刪除帳號執行完成（deletion.ts；寄到刪除前的 Email，之後 Email 就不存在了）
// 寄信走 services.ts 的 getMailer（本機印 console，正式站 Resend，寄件人 notify.dblzm.com）。
// 寄不出去不影響主要動作：失敗只記 console.error，不往外丟。
// 每封信都寫原因與申訴入口（收藏鎖定＝單則頁的申訴；其他＝寫信到 CONTACT_EMAIL），文案台灣用語、不用破折號。

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { SITE_NAME } from "@/lib/data";
import { CANONICAL_ORIGIN } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/legal";
import { getMailer } from "@/lib/server/services";

const site = CANONICAL_ORIGIN;

async function recipient(userId: string) {
  const [u] = await getDb().select({ email: users.email, handle: users.handle, status: users.status }).from(users).where(eq(users.id, userId));
  if (!u || u.status === "deleted" || !u.email || u.email.endsWith("@deleted.invalid")) return null;
  return u;
}

async function send(to: string, subject: string, lines: string[]) {
  try {
    await getMailer().send({ to, subject: `${SITE_NAME}：${subject}`, text: lines.join("\n") });
    return true;
  } catch (e) {
    console.error("[樂迷藏通知信] 寄送失敗", subject, e);
    return false;
  }
}

const foot = (appeal: string) => ["", appeal, "", `這封信由系統自動寄出，有問題直接回信或寫到 ${CONTACT_EMAIL}。`, SITE_NAME];

/** 收藏因檢舉達門檻被鎖定（交易暫停、照片暫時隱藏） */
export async function notifyShareLocked(authorId: string, shareNo: number, what: string, reasonText: string, count: number) {
  const u = await recipient(authorId);
  if (!u) return false;
  return send(u.email, `你的收藏 #${shareNo} 因多人檢舉暫停交易`, [
    `@${u.handle} 你好，`,
    "",
    `你發布的收藏「${what}」（${site}/share/${shareNo}）收到 ${count} 位會員檢舉，已達網站的檢舉門檻。`,
    `檢舉理由：${reasonText}`,
    "",
    "依使用條款第 12 條，這則收藏目前交易暫停、照片暫時不公開，其他內容照常顯示。",
    ...foot(`你認為檢舉不成立，請登入後到這則收藏的頁面按「申訴」，附上說明或證據照片，我們會在 14 日內回覆。${site}/share/${shareNo}`),
  ]);
}

/** 管理員隱藏收藏 */
export async function notifyShareHidden(authorId: string, shareNo: number, what: string, reason: string) {
  const u = await recipient(authorId);
  if (!u) return false;
  return send(u.email, `你的收藏 #${shareNo} 已被下架`, [
    `@${u.handle} 你好，`,
    "",
    `你發布的收藏「${what}」（${site}/share/${shareNo}）已由管理員下架，前台看不到這則與它的照片。`,
    `原因：${reason || "違反使用條款（管理員未填寫細節）"}`,
    ...foot(`你認為下架有誤，請回信或寫到 ${CONTACT_EMAIL} 說明，寫明收藏編號 #${shareNo}，我們會在 14 日內回覆。`),
  ]);
}

/** 留言被刪除或自動隱藏 */
export async function notifyCommentRemoved(authorId: string, commentId: number, shareNo: number, body: string, how: "deleted" | "hidden", reason: string) {
  const u = await recipient(authorId);
  if (!u) return false;
  const what = how === "deleted" ? "已被管理員刪除" : "因多人檢舉暫時隱藏";
  return send(u.email, `你的留言${what}`, [
    `@${u.handle} 你好，`,
    "",
    `你在收藏 #${shareNo}（${site}/share/${shareNo}）底下的留言${what}：`,
    `「${body.slice(0, 120)}${body.length > 120 ? "…" : ""}」`,
    `原因：${reason}`,
    ...foot(`你認為處理有誤，請回信或寫到 ${CONTACT_EMAIL} 說明，寫明留言編號 #${commentId}，我們會在 14 日內回覆。`),
  ]);
}

/** 管理員移除大頭貼 */
export async function notifyAvatarRemoved(userId: string, reason: string) {
  const u = await recipient(userId);
  if (!u) return false;
  return send(u.email, "你的大頭貼已被移除", [
    `@${u.handle} 你好，`,
    "",
    "你的大頭貼已由管理員移除，個人頁與留言改用暱稱字樣頭像。",
    `原因：${reason || "違反使用條款（管理員未填寫細節）"}`,
    "你可以到設定頁重新上傳一張符合條款的照片。",
    ...foot(`你認為處理有誤，請回信或寫到 ${CONTACT_EMAIL} 說明，我們會在 14 日內回覆。`),
  ]);
}

/** 停權（已登出所有裝置、不能再登入）；frozen＝一併收掉的出售中收藏與出價數 */
export async function notifySuspended(userId: string, email: string, handle: string, reasonText: string, frozen: { shares: number; offers: number }) {
  return send(email, "你的帳號已暫停使用", [
    `@${handle} 你好，`,
    "",
    "你的帳號已由管理員停權，目前不能登入。",
    `原因：${reasonText}`,
    "",
    "停權期間：",
    `・你名下出售中的收藏（${frozen.shares} 則）已改成不開放交易，其他人不能再出價`,
    `・你送出、還沒處理的出價（${frozen.offers} 筆）已撤回，對方會在對話裡看到通知`,
    "・其他會員無法再傳私訊給你",
    "・已發布的收藏與留言照常顯示（管理員另外下架的除外）",
    ...foot(`你認為停權有誤，請回信或寫到 ${CONTACT_EMAIL} 說明，我們會在 14 日內回覆。`),
  ]);
}

export async function notifyRestored(userId: string) {
  const u = await recipient(userId);
  if (!u) return false;
  return send(u.email, "你的帳號已恢復使用", [
    `@${u.handle} 你好，`,
    "",
    "你的帳號已恢復，可以照常登入。",
    "停權時改成不開放交易的收藏不會自動恢復出售，需要的話請自己到各則收藏頁重新打開。",
    ...foot(`有問題寫到 ${CONTACT_EMAIL}。`),
  ]);
}

/** 刪除帳號執行完成（寄到刪除前的 Email） */
export async function notifyDeleted(email: string, handle: string, info: { deletePhotos: boolean; reburnPending: number; shares: number; offers: number }) {
  return send(email, "你的帳號已刪除", [
    `@${handle} 你好，`,
    "",
    "你申請刪除帳號的請求已處理完成，帳號無法再登入，Email、密碼、登入狀態、所在地區紀錄、封鎖名單都已刪除。",
    "",
    "依使用條款第 15 條：",
    "・炫收藏、編輯紀錄、留言保留在網站上，發布者改顯示為「已刪除的會員」",
    info.deletePhotos ? "・你選擇連同照片一起刪除，照片檔已從伺服器移除" : `・照片依你的選擇保留；照片上的浮水印會從原圖重燒成匿名代號（${info.reburnPending} 張，7 日內完成），之後原圖刪除`,
    `・出售中的收藏（${info.shares} 則）已改成不開放交易，還沒處理的出價（${info.offers} 筆）已撤回`,
    "・出價、成交、私訊、檢舉與申訴紀錄保留 3 年後刪除",
    "",
    "搜尋引擎的快取需要一段時間才會更新，刪除後幾週內可能還搜得到舊的頁面；要加快移除可以用 Google 的「移除過時內容」工具：https://search.google.com/search-console/remove-outdated-content",
    ...foot(`有問題寫到 ${CONTACT_EMAIL}。`),
  ]);
}

/** 管理員警示（排程失敗、備份失敗）：收件人＝ADMIN_EMAILS 第一位 */
export async function notifyAdmin(subject: string, lines: string[]) {
  const to = (env.ADMIN_EMAILS ?? "").split(",").map((x) => x.trim()).filter(Boolean)[0];
  if (!to) return false;
  return send(to, subject, lines);
}
