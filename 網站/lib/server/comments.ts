// 單則炫收藏的留言（2026-09-28）。
//
// - 登入、已驗證 Email 才能留言；不看連線國家（海外帳號可以留言，交易才限台灣）
// - 純文字 500 字以內，存原文；畫面一律當文字輸出（React 預設跳脫），不轉 HTML
// - 刪除：留言者刪自己的；發文者與管理員可以刪該則收藏底下任何留言。一律軟刪除（deleted_at）
// - 檢舉：已驗證帳號、一人一則一次；達門檻（預設 3，後台可調）自動隱藏，等管理員恢復或刪除
// - 頻率：每個帳號每分鐘 3 則、每天 50 則（rate_limits 固定視窗）
// - comments／comment_reports 沒有內容版本觸發器：寫入不會讓整頁快取失效
// - 留言者被停權、帳號不存在：留言不顯示

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, commentReports, comments, settings, shares, users } from "@/db/schema";
import {
  charCount,
  cleanComment,
  COMMENT_MAX,
  COMMENT_PER_DAY,
  COMMENT_PER_MINUTE,
  COMMENT_REASONS,
  DEFAULT_COMMENT_THRESHOLD,
  looksOffsite,
} from "@/lib/comment-rules";
import { isAdmin, type User } from "@/lib/server/auth";
import { userBadges } from "@/lib/server/scores";
import { hit } from "@/lib/server/services";
import { HttpError } from "@/lib/server/trade";

const nowIso = () => new Date().toISOString();
const LIST_LIMIT = 200;

export type CommentView = {
  id: number;
  author: { handle: string; name: string; badge: string };
  body: string;
  at: string;
  mine: boolean;
  canDelete: boolean;
  reported: boolean;
  warn: boolean;
};

export async function commentThreshold() {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, "comment_report_threshold"));
  const n = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_COMMENT_THRESHOLD;
}

async function visibleShare(no: number) {
  if (!Number.isInteger(no) || no <= 0) return null;
  const [s] = await getDb()
    .select({ no: shares.no, authorId: shares.authorId })
    .from(shares)
    .where(and(eq(shares.no, no), isNull(shares.deletedAt), isNull(shares.hiddenAt)));
  return s ?? null;
}

/** 某則收藏的留言（舊的在前，最多 200 則）。viewer 可以是 null */
export async function listComments(no: number, viewer: User | null) {
  const s = await visibleShare(no);
  if (!s) throw new HttpError(404, "NOT_FOUND", "找不到這則炫收藏");
  const db = getDb();
  const rows = await db
    .select({ id: comments.id, authorId: comments.authorId, body: comments.body, at: comments.createdAt, handle: users.handle, name: users.name })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(and(eq(comments.shareNo, no), isNull(comments.deletedAt), isNull(comments.hiddenAt), eq(users.status, "active")))
    .orderBy(desc(comments.id))
    .limit(LIST_LIMIT);
  rows.reverse();
  const me = viewer?.id ?? "";
  const admin = isAdmin(viewer);
  const mineReported = me && rows.length
    ? new Set(
        (
          await db
            .select({ c: commentReports.commentId })
            .from(commentReports)
            .where(and(eq(commentReports.reporterId, me), inArray(commentReports.commentId, rows.map((r) => r.id))))
        ).map((r) => r.c),
      )
    : new Set<number>();
  const badges = await userBadges(rows.map((r) => r.authorId));
  const list: CommentView[] = rows.map((r) => ({
    id: r.id,
    author: { handle: r.handle, name: r.name, badge: badges.get(r.authorId) ?? "" },
    body: r.body,
    at: r.at,
    mine: r.authorId === me,
    canDelete: Boolean(me) && (r.authorId === me || s.authorId === me || admin),
    reported: mineReported.has(r.id),
    warn: looksOffsite(r.body),
  }));
  return {
    comments: list,
    canPost: Boolean(viewer?.emailVerifiedAt),
    max: COMMENT_MAX,
  };
}

export async function postComment(u: User, rawNo: unknown, rawBody: unknown) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "NOT_VERIFIED", "驗證 Email 後才能留言");
  const no = Number(rawNo);
  const body = cleanComment(typeof rawBody === "string" ? rawBody : "");
  if (!body) throw new HttpError(400, "INVALID", "寫點什麼再送出");
  if (charCount(body) > COMMENT_MAX) throw new HttpError(400, "TOO_LONG", `留言最多 ${COMMENT_MAX} 字`);
  if (!(await visibleShare(no))) throw new HttpError(404, "NOT_FOUND", "找不到這則炫收藏");
  if (!(await hit(`comment-min:${u.id}`, COMMENT_PER_MINUTE, 60))) throw new HttpError(429, "RATE_LIMITED", "留言太快了，等一分鐘再試");
  if (!(await hit(`comment-day:${u.id}`, COMMENT_PER_DAY, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天留言太多則了，明天再來");
  const [r] = await getDb().insert(comments).values({ shareNo: no, authorId: u.id, body }).returning({ id: comments.id, at: comments.createdAt });
  return { id: r.id, at: r.at, warn: looksOffsite(body) };
}

export async function deleteComment(u: User, id: number) {
  const db = getDb();
  const [c] = await db
    .select({ id: comments.id, authorId: comments.authorId, shareNo: comments.shareNo, deletedAt: comments.deletedAt, shareAuthor: shares.authorId })
    .from(comments)
    .innerJoin(shares, eq(shares.no, comments.shareNo))
    .where(eq(comments.id, id));
  if (!c || c.deletedAt) throw new HttpError(404, "NOT_FOUND", "找不到這則留言");
  const admin = isAdmin(u);
  if (c.authorId !== u.id && c.shareAuthor !== u.id && !admin) throw new HttpError(403, "FORBIDDEN", "只能刪自己的留言，或自己收藏底下的留言");
  await db.update(comments).set({ deletedAt: nowIso(), deletedBy: u.id }).where(eq(comments.id, id));
  if (admin && c.authorId !== u.id && c.shareAuthor !== u.id) {
    await db.insert(adminLog).values({ adminId: u.id, action: "刪除留言", target: `comment:${id}`, detail: JSON.stringify({ share: c.shareNo }) });
  }
}

export async function reportComment(u: User, rawTarget: string, reason: unknown, note: unknown) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "NOT_VERIFIED", "認證後才能檢舉");
  const m = rawTarget.match(/^comment:(\d{1,9})$/);
  if (!m) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const id = Number(m[1]);
  if (!COMMENT_REASONS.some((r) => r.key === reason)) throw new HttpError(400, "BAD_REQUEST", "檢舉理由不對");
  const text = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (reason === "other" && !text) throw new HttpError(400, "INVALID", "寫一句原因");
  const db = getDb();
  const [c] = await db
    .select({ id: comments.id, authorId: comments.authorId, hiddenAt: comments.hiddenAt, decision: comments.decision })
    .from(comments)
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)));
  if (!c) throw new HttpError(404, "NOT_FOUND", "找不到這則留言");
  if (c.authorId === u.id) throw new HttpError(403, "FORBIDDEN", "不能檢舉自己的留言");
  if (!(await hit(`report:${u.id}`, 30, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天檢舉太多次了");
  const r = await db
    .insert(commentReports)
    .values({ commentId: id, reporterId: u.id, reason: reason as string, note: text })
    .onConflictDoNothing()
    .returning({ id: commentReports.id });
  if (!r.length) throw new HttpError(409, "ALREADY_REPORTED", "已經檢舉過了");
  const [n] = await db.select({ n: count() }).from(commentReports).where(eq(commentReports.commentId, id));
  const total = n?.n ?? 0;
  let hidden = Boolean(c.hiddenAt);
  if (!hidden && c.decision !== "kept" && total >= (await commentThreshold())) {
    await db.update(comments).set({ hiddenAt: nowIso() }).where(and(eq(comments.id, id), isNull(comments.hiddenAt)));
    hidden = true;
  }
  return { count: total, hidden };
}

/* ---------- 管理後台 ---------- */

/** 被檢舉過（還沒處理）或被自動隱藏的留言 */
export async function adminComments() {
  const db = getDb();
  const [rows, th] = await Promise.all([
    db
      .select({
        id: comments.id,
        shareNo: comments.shareNo,
        body: comments.body,
        at: comments.createdAt,
        hiddenAt: comments.hiddenAt,
        decision: comments.decision,
        name: users.name,
        handle: users.handle,
        reports: sql<number>`(SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = ${comments.id})`,
        reasons: sql<string>`(SELECT GROUP_CONCAT(reason) FROM comment_reports r WHERE r.comment_id = ${comments.id})`,
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(
        and(
          isNull(comments.deletedAt),
          or(isNotNull(comments.hiddenAt), and(isNull(comments.decision), sql`EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = ${comments.id})`)),
        ),
      )
      .orderBy(asc(comments.id))
      .limit(200),
    commentThreshold(),
  ]);
  return {
    threshold: th,
    list: rows.map((r) => {
      const byReason: Record<string, number> = {};
      (r.reasons ?? "").split(",").filter(Boolean).forEach((k) => (byReason[k] = (byReason[k] ?? 0) + 1));
      return {
        id: r.id,
        share: r.shareNo,
        body: r.body,
        at: r.at,
        by: r.name ?? "（已刪除）",
        handle: r.handle ?? "",
        reports: Number(r.reports),
        reasons: byReason,
        hidden: Boolean(r.hiddenAt),
        warn: looksOffsite(r.body),
      };
    }),
  };
}

/** restore＝恢復顯示並標記保留（之後不再自動隱藏）；delete＝刪除 */
export async function moderateComment(admin: User, rawId: unknown, action: unknown) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || (action !== "restore" && action !== "delete")) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const db = getDb();
  const [c] = await db.select({ id: comments.id, shareNo: comments.shareNo }).from(comments).where(and(eq(comments.id, id), isNull(comments.deletedAt)));
  if (!c) throw new HttpError(404, "NOT_FOUND", "找不到這則留言");
  if (action === "restore") await db.update(comments).set({ hiddenAt: null, decision: "kept" }).where(eq(comments.id, id));
  else await db.update(comments).set({ deletedAt: nowIso(), deletedBy: admin.id }).where(eq(comments.id, id));
  await db
    .insert(adminLog)
    .values({ adminId: admin.id, action: action === "restore" ? "恢復留言" : "刪除留言", target: `comment:${id}`, detail: JSON.stringify({ share: c.shareNo }) });
}

export async function setCommentThreshold(admin: User, n: unknown) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, "INVALID", "填 1 以上的整數");
  const before = await commentThreshold();
  await getDb()
    .insert(settings)
    .values({ key: "comment_report_threshold", value: String(n) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(n), updatedAt: nowIso() } });
  await getDb().insert(adminLog).values({ adminId: admin.id, action: "調整留言檢舉門檻", target: "comment_report_threshold", detail: JSON.stringify({ from: before, to: n }) });
}
