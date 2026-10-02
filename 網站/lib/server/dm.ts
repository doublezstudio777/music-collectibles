// 私訊防騷擾（2026-10-01）：驗證 Email 才能發、每天主動開新對話上限、封鎖、檢舉，以及從個人頁發起的直接私訊。
//
// - 「開新對話」＝發起人在一條還沒開始的對話送出第一則（文字、出價、我要買都算），發起人是 threads.buyer_id。
//   已經開始的對話（started_at 有值）不受上限。上限存 settings.dm_daily_new_limit，後台可調，預設 10
// - 封鎖：任一方封鎖另一方，兩人之間都不能再傳訊息、開新對話（封鎖的人要先解除）
// - 檢舉：對話的任一方可以檢舉另一方，一人一條對話一次；後台只看誰檢舉誰、理由與補充，不讀訊息內容

import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, dmReports, messages, settings, threads, userBlocks, users } from "@/db/schema";
import { hit } from "@/lib/server/services";
import { avatarUrl, type User } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/trade";
import { relTime } from "@/lib/data";

import { DEFAULT_DM_DAILY_LIMIT, DM_REPORT_REASONS } from "@/lib/dm-rules";

const nowIso = () => new Date().toISOString();

/** 台灣今天 00:00 的 UTC ISO 字串 */
export function taiwanDayStart(now = Date.now()) {
  const tw = new Date(now + 8 * 3600_000);
  return new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600_000).toISOString();
}

export async function dmDailyLimit() {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, "dm_daily_new_limit"));
  const n = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_DM_DAILY_LIMIT;
}

export async function setDmDailyLimit(admin: User, n: unknown) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, "INVALID", "填 1 到 1000 的整數");
  const before = await dmDailyLimit();
  const db = getDb();
  await db
    .insert(settings)
    .values({ key: "dm_daily_new_limit", value: String(n) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(n), updatedAt: nowIso() } });
  await db.insert(adminLog).values({ adminId: admin.id, action: "調整每日開新對話上限", target: "dm_daily_new_limit", detail: JSON.stringify({ from: before, to: n }) });
}

/** 今天已經主動開了幾個新對話 */
export async function startedToday(userId: string) {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(threads)
    .where(and(eq(threads.buyerId, userId), isNotNull(threads.startedAt), gte(threads.startedAt, taiwanDayStart())));
  return Number(r?.n ?? 0);
}

export function assertVerified(u: User) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "EMAIL_UNVERIFIED", "驗證 Email 後才能私訊");
}

/** 兩人之間的封鎖狀態：me＝我封鎖對方、them＝對方封鎖我 */
export async function blockState(meId: string, otherId: string): Promise<"me" | "them" | null> {
  if (!otherId || meId === otherId) return null;
  const rows = await getDb()
    .select()
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, meId), eq(userBlocks.blockedId, otherId)),
        and(eq(userBlocks.blockerId, otherId), eq(userBlocks.blockedId, meId)),
      ),
    );
  if (rows.some((r) => r.blockerId === meId)) return "me";
  if (rows.length) return "them";
  return null;
}

export async function assertNotBlocked(meId: string, otherId: string) {
  const b = await blockState(meId, otherId);
  if (b === "me") throw new HttpError(403, "BLOCKED_BY_ME", "你已封鎖這位會員，解除封鎖後才能傳訊息");
  if (b === "them") throw new HttpError(403, "BLOCKED", "目前無法傳訊息給這位會員");
}

/**
 * 送出任何一則訊息前（文字、出價、我要買）：封鎖檢查；對話還沒開始就算一次「開新對話」，
 * 發起人超過每日上限就擋，沒超過就記下 started_at
 */
export async function beforeSend(u: User, t: { id: number; buyerId: string; peerId?: string | null; shareNo?: number; startedAt: string | null }, otherId: string) {
  await assertNotBlocked(u.id, otherId);
  if (t.startedAt) return;
  // 誰先傳第一句，誰算開了這個新對話（2026-10-02 總檢 L3）：直接私訊若是被開的那一方先講話，把發起人換成他，
  // 額度才會算在真正開口的人身上（原本固定算在 buyer_id，對方先回就不計、還算進開的人）
  const direct = (t.shareNo ?? 1) === 0 && t.peerId === u.id && t.buyerId !== u.id;
  const limit = await dmDailyLimit();
  if ((t.buyerId === u.id || direct) && (await startedToday(u.id)) >= limit)
    throw new HttpError(429, "DM_DAILY_LIMIT", `今天已經開了 ${limit} 個新對話，明天再試；已經在聊的對話不受影響`);
  await getDb()
    .update(threads)
    .set(direct ? { startedAt: nowIso(), buyerId: u.id, peerId: t.buyerId } : { startedAt: nowIso() })
    .where(and(eq(threads.id, t.id), sql`${threads.startedAt} IS NULL`));
}

/* ---------- 直接私訊（個人頁「傳訊息」） ---------- */

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 開（或找回）跟這位會員的直接私訊，回傳對話 id */
export async function openDirect(u: User, handle: unknown) {
  assertVerified(u);
  const h = typeof handle === "string" ? handle.trim().toLowerCase() : "";
  if (!h) throw new HttpError(404, "NOT_FOUND", "找不到這位會員");
  const db = getDb();
  const [other] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.handle, h));
  if (!other || other.status !== "active") throw new HttpError(404, "NOT_FOUND", "找不到這位會員");
  if (other.id === u.id) throw new HttpError(403, "FORBIDDEN", "不能傳訊息給自己");
  const key = pairKey(u.id, other.id);
  const [found] = await db.select({ id: threads.id }).from(threads).where(eq(threads.pairKey, key));
  if (found) return found.id;
  await assertNotBlocked(u.id, other.id);
  // 開空對話也有上限（2026-10-02 總檢 L4）：每小時 30 條，免得對任何人狂建空對話
  if (!(await hit(`dm-open:${u.id}`, 30, 3600))) throw new HttpError(429, "RATE_LIMITED", "開太多對話了，等一下再試");
  await db.insert(threads).values({ shareNo: 0, buyerId: u.id, peerId: other.id, pairKey: key }).onConflictDoNothing();
  const [t] = await db.select({ id: threads.id }).from(threads).where(eq(threads.pairKey, key));
  return t.id;
}

/* ---------- 封鎖 ---------- */

export async function setBlock(u: User, handle: unknown, blocked: unknown) {
  const h = typeof handle === "string" ? handle.trim().toLowerCase() : "";
  const db = getDb();
  const [other] = h ? await db.select({ id: users.id }).from(users).where(eq(users.handle, h)) : [];
  if (!other) throw new HttpError(404, "NOT_FOUND", "找不到這位會員");
  if (other.id === u.id) throw new HttpError(400, "BAD_REQUEST", "不能封鎖自己");
  if (blocked === true) {
    await db.insert(userBlocks).values({ blockerId: u.id, blockedId: other.id }).onConflictDoNothing();
  } else if (blocked === false) {
    await db.delete(userBlocks).where(and(eq(userBlocks.blockerId, u.id), eq(userBlocks.blockedId, other.id)));
  } else throw new HttpError(400, "BAD_REQUEST", "參數不對");
}

export async function myBlocks(u: User) {
  const rows = await getDb()
    .select({ handle: users.handle, name: users.name, avatarKey: users.avatarKey, at: userBlocks.createdAt })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, u.id))
    .orderBy(desc(userBlocks.createdAt));
  const now = Date.now();
  return rows.map((r) => ({ handle: r.handle, name: r.name, avatar: avatarUrl(r.avatarKey), time: relTime(r.at, now) }));
}

/* ---------- 檢舉 ---------- */

export async function reportThread(u: User, t: { id: number }, otherId: string, reason: unknown, note: unknown) {
  if (typeof reason !== "string" || !(DM_REPORT_REASONS as readonly string[]).includes(reason)) throw new HttpError(400, "BAD_REQUEST", "選一個理由");
  const text = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (reason === "other" && !text) throw new HttpError(400, "INVALID", "寫一句原因");
  if (!otherId) throw new HttpError(409, "GONE", "對方帳號已經不在了");
  const db = getDb();
  // 對方要真的在這段對話講過話才能檢舉（2026-10-02 總檢 L4）：空對話、只有自己講的不收
  const [spoke] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.threadId, t.id), eq(messages.fromId, otherId)))
    .limit(1);
  if (!spoke) throw new HttpError(409, "NO_MESSAGES", "對方還沒在這段對話傳過訊息，沒有可以檢舉的內容");
  const r = await db
    .insert(dmReports)
    .values({ threadId: t.id, reporterId: u.id, reportedId: otherId, reason, note: text })
    .onConflictDoNothing()
    .returning({ id: dmReports.id });
  if (!r.length) throw new HttpError(409, "ALREADY_REPORTED", "已經檢舉過這段對話");
}

export async function reportedThreads(userId: string, ids: number[]) {
  if (!ids.length) return new Set<number>();
  const out = new Set<number>();
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await getDb()
      .select({ t: dmReports.threadId })
      .from(dmReports)
      .where(and(eq(dmReports.reporterId, userId), inArray(dmReports.threadId, ids.slice(i, i + 90))));
    rows.forEach((r) => out.add(r.t));
  }
  return out;
}

export type AdminDmReport = Awaited<ReturnType<typeof adminDmReports>>["reports"][number];

/** 後台：私訊檢舉清單（不含訊息內容） */
export async function adminDmReports() {
  const db = getDb();
  const rows = await db.select().from(dmReports).orderBy(desc(dmReports.id)).limit(300);
  const ids = Array.from(new Set(rows.flatMap((r) => [r.reporterId, r.reportedId, r.handledBy ?? ""]).filter(Boolean)));
  const people = new Map<string, { handle: string; name: string; status: string }>();
  for (let i = 0; i < ids.length; i += 90) {
    const us = await db
      .select({ id: users.id, handle: users.handle, name: users.name, status: users.status })
      .from(users)
      .where(inArray(users.id, ids.slice(i, i + 90)));
    us.forEach((x) => people.set(x.id, x));
  }
  const tids = Array.from(new Set(rows.map((r) => r.threadId)));
  const kinds = new Map<number, number>();
  for (let i = 0; i < tids.length; i += 90) {
    const ts = await db.select({ id: threads.id, shareNo: threads.shareNo }).from(threads).where(inArray(threads.id, tids.slice(i, i + 90)));
    ts.forEach((x) => kinds.set(x.id, x.shareNo));
  }
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(r.reportedId, (counts.get(r.reportedId) ?? 0) + 1));
  const now = Date.now();
  const who = (id: string | null) => (id ? (people.get(id) ?? { handle: "", name: "（已刪除）", status: "deleted" }) : null);
  return {
    limit: await dmDailyLimit(),
    reports: rows.map((r) => ({
      id: r.id,
      thread: r.threadId,
      share: kinds.get(r.threadId) ?? 0,
      reporter: who(r.reporterId)!,
      reported: who(r.reportedId)!,
      reportedTotal: counts.get(r.reportedId) ?? 0,
      reason: r.reason,
      note: r.note,
      status: r.status,
      handledBy: who(r.handledBy)?.name ?? "",
      time: relTime(r.createdAt, now),
    })),
  };
}

export async function handleDmReport(admin: User, id: unknown, status: unknown) {
  if (typeof id !== "number" || !Number.isInteger(id) || (status !== "done" && status !== "open")) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const db = getDb();
  const [r] = await db.select({ id: dmReports.id }).from(dmReports).where(eq(dmReports.id, id));
  if (!r) throw new HttpError(404, "NOT_FOUND", "找不到這筆檢舉");
  await db
    .update(dmReports)
    .set(status === "done" ? { status, handledBy: admin.id, handledAt: nowIso() } : { status, handledBy: null, handledAt: null })
    .where(eq(dmReports.id, id));
  await db.insert(adminLog).values({ adminId: admin.id, action: status === "done" ? "私訊檢舉標為已處理" : "私訊檢舉改回待處理", target: `dm_report:${id}` });
}
