// 管理後台：會員管理（2026-09-28）。
// 不看私訊內容：只算對話數（當買家或賣家的對話條數），不讀 messages 表。
// 停權：status=suspended、登出所有裝置（刪 sessions），登入時 userByToken 會擋；內容不自動隱藏（要隱藏另外用下架）。
// 恢復：status=active。兩者都寫 admin_log。管理員帳號（ADMIN_EMAILS）與自己不能停權。
// 2026-09-28 等級定案：停權必填原因（下拉選單＋說明），另記一列 suspensions（分數凍結用）；
// 管理員可以指定會員等級（level_overrides），必填原因、寫 admin_log，可以取消指定。

import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { adminLog, levelOverrides, suspensions, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { LEVELS, levelLabel, levelOf } from "@/lib/levels";
import { destroyAllSessions, isAdmin, type User } from "@/lib/server/auth";
import { regionNames } from "@/lib/server/geo";

export const PAGE_SIZE = 50;

/** 停權原因（下拉選單） */
export const SUSPEND_REASONS = { fraud: "詐騙", piracy: "販售盜版", sockpuppet: "分身刷分", spam: "洗版或騷擾", copyright: "著作權侵權達三次", other: "其他" } as const;
export type SuspendReason = keyof typeof SUSPEND_REASONS;
export const suspendReasonText = (code: string, note: string) =>
  [SUSPEND_REASONS[code as SuspendReason] ?? code, note].filter(Boolean).join("：");

export type MemberRow = {
  id: string;
  name: string;
  handle: string;
  email: string;
  createdAt: string;
  region: string;
  verified: boolean;
  posts: number;
  deals: number;
  reported: number;
  threads: number;
  status: string;
  deletionRequested: boolean;
  admin: boolean;
  score: number;
  /** 目前顯示的等級（有指定就是指定的） */
  level: string;
  /** 管理員指定的等級 1～25；沒指定是 null */
  override: number | null;
  overrideReason: string;
  /** 停權中：原因文字（「分身刷分：說明」） */
  suspendReason: string;
  /** 大頭貼網址（2026-09-28） */
  avatar: string | null;
  /** 改過幾次暱稱（紀錄只有管理員看得到） */
  renames: number;
};

export async function searchMembers(query: string, status: string, page: number) {
  const db = env.DB!;
  const q = query.trim().toLowerCase().slice(0, 60);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const st = status === "active" || status === "suspended" || status === "deleted" ? status : "";
  const where = `WHERE (?1 = '' OR lower(u.name) LIKE ?2 ESCAPE '\\' OR u.email LIKE ?2 ESCAPE '\\' OR u.handle LIKE ?2 ESCAPE '\\') AND (?3 = '' OR u.status = ?3)`;
  const [list, total] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.name, u.handle, u.email, u.created_at AS createdAt, u.email_verified_at AS verifiedAt, u.status,
                u.deletion_requested_at AS delReq, u.avatar_key AS avatarKey,
                (SELECT COUNT(*) FROM user_name_changes nc WHERE nc.user_id = u.id) AS renames,
                (SELECT COUNT(*) FROM shares s WHERE s.author_id = u.id AND s.deleted_at IS NULL) AS posts,
                (SELECT COUNT(*) FROM deals d WHERE d.voided_at IS NULL AND (d.seller_id = u.id OR d.buyer_id = u.id)) AS deals,
                (SELECT COUNT(*) FROM reports r JOIN shares s2 ON r.target = 'share:' || s2.no WHERE s2.author_id = u.id) AS reported,
                (SELECT COUNT(*) FROM threads t LEFT JOIN shares s3 ON s3.no = t.share_no AND t.share_no > 0 WHERE t.buyer_id = u.id OR t.peer_id = u.id OR s3.author_id = u.id) AS threads,
                COALESCE(sc.score, 0) AS score, lo.level AS override, lo.reason AS overrideReason,
                (SELECT su.reason || char(31) || su.note FROM suspensions su WHERE su.user_id = u.id AND su.ended_at IS NULL ORDER BY su.id DESC LIMIT 1) AS susp
         FROM users u LEFT JOIN user_scores sc ON sc.user_id = u.id LEFT JOIN level_overrides lo ON lo.user_id = u.id ${where} ORDER BY u.created_at DESC LIMIT ?4 OFFSET ?5`,
      )
      .bind(q, like, st, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(q, like, st),
  ]);
  const rows = list.results as {
    id: string; name: string; handle: string; email: string; createdAt: string; verifiedAt: string | null; status: string;
    delReq: string | null; avatarKey: string | null; renames: number; posts: number; deals: number; reported: number; threads: number;
    score: number; override: number | null; overrideReason: string | null; susp: string | null;
  }[];
  const regions = await regionNames(rows.map((r) => r.id));
  const members: MemberRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    handle: r.handle,
    email: r.email,
    createdAt: r.createdAt,
    region: regions.get(r.id) ?? "未知",
    verified: Boolean(r.verifiedAt),
    posts: r.posts,
    deals: r.deals,
    reported: r.reported,
    threads: r.threads,
    status: r.status,
    deletionRequested: Boolean(r.delReq),
    admin: isAdmin({ email: r.email, emailVerifiedAt: r.verifiedAt }),
    score: r.score,
    level: levelOf(r.score, r.override).label,
    override: r.override,
    overrideReason: r.overrideReason ?? "",
    avatar: r.avatarKey ? `/img/${r.avatarKey}` : null,
    renames: r.renames,
    suspendReason: r.status === "suspended" ? (r.susp ? suspendReasonText(...(r.susp.split("\u001f") as [string, string])) : "原因未記錄") : "",
  }));
  return { members, total: (total.results[0] as { n: number }).n, page, pageSize: PAGE_SIZE };
}

export class MemberError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function setMemberStatus(admin: User, id: string, action: string, reasonCode: string, note: string) {
  if (action !== "suspend" && action !== "restore") throw new MemberError(400, "BAD_REQUEST", "參數不對");
  const code = reasonCode as SuspendReason;
  const text = note.trim().slice(0, 200);
  if (action === "suspend") {
    if (!(code in SUSPEND_REASONS)) throw new MemberError(400, "INVALID", "選一個停權原因");
    if (code === "other" && !text) throw new MemberError(400, "INVALID", "原因選「其他」要寫說明");
  }
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new MemberError(404, "NOT_FOUND", "找不到這位會員");
  if (u.id === admin.id || isAdmin(u)) throw new MemberError(403, "FORBIDDEN", "管理員帳號不能停權");
  if (u.status === "deleted") throw new MemberError(409, "DELETED", "這個帳號已經刪除");
  const to = action === "suspend" ? "suspended" : "active";
  if (u.status === to) throw new MemberError(409, "UNCHANGED", action === "suspend" ? "這位已經停權" : "這位沒有被停權");
  const at = new Date().toISOString();
  await db.update(users).set({ status: to, updatedAt: at }).where(eq(users.id, id));
  if (to === "suspended") {
    await destroyAllSessions(id);
    await db.insert(suspensions).values({ userId: id, reason: code, note: text, startedAt: at, byAdmin: admin.id });
  } else {
    await db.update(suspensions).set({ endedAt: at }).where(and(eq(suspensions.userId, id), isNull(suspensions.endedAt)));
  }
  await db.insert(adminLog).values({
    adminId: admin.id,
    action: to === "suspended" ? "停權會員" : "恢復會員",
    target: `user:${u.handle}`,
    detail: JSON.stringify(to === "suspended" ? { reason: suspendReasonText(code, text), code, note: text } : { reason: text }),
  });
  return to;
}

/** 指定等級（level 1～25，必填原因）／取消指定（level 為 null）。分數照常累計，只改顯示 */
export async function setMemberLevel(admin: User, id: string, level: number | null, reason: string) {
  const text = reason.trim().slice(0, 200);
  if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= LEVELS.length)) throw new MemberError(400, "INVALID", "等級不對");
  if (level !== null && !text) throw new MemberError(400, "INVALID", "寫一下指定等級的原因");
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new MemberError(404, "NOT_FOUND", "找不到這位會員");
  if (isAdmin(u)) throw new MemberError(403, "FORBIDDEN", "管理員固定顯示館長，不能指定等級");
  const [cur] = await db.select().from(levelOverrides).where(eq(levelOverrides.userId, id));
  const at = new Date().toISOString();
  if (level === null) {
    if (!cur) throw new MemberError(409, "UNCHANGED", "這位沒有被指定等級");
    await db.delete(levelOverrides).where(eq(levelOverrides.userId, id));
  } else {
    await db
      .insert(levelOverrides)
      .values({ userId: id, level, reason: text, byAdmin: admin.id, at })
      .onConflictDoUpdate({ target: levelOverrides.userId, set: { level, reason: text, byAdmin: admin.id, at } });
  }
  await db.insert(adminLog).values({
    adminId: admin.id,
    action: level === null ? "取消指定等級" : "指定等級",
    target: `user:${u.handle}`,
    detail: JSON.stringify({
      reason: text,
      ...(level === null ? {} : { level, label: levelLabel(level) }),
      ...(cur ? { from: cur.level, fromLabel: levelLabel(cur.level) } : {}),
    }),
  });
  return level;
}

/** 某位會員的停權／恢復／指定等級紀錄 */
export async function memberLog(handle: string) {
  const r = await env
    .DB!.prepare(`SELECT action, detail, created_at AS at FROM admin_log WHERE target = ?1 ORDER BY id DESC LIMIT 20`)
    .bind(`user:${handle}`)
    .all();
  return r.results as { action: string; detail: string; at: string }[];
}

/** 某位會員的改名紀錄（新到舊，只有管理員看得到） */
export async function nameHistory(userId: string) {
  const r = await env
    .DB!.prepare(`SELECT old_name AS oldName, new_name AS newName, created_at AS at FROM user_name_changes WHERE user_id = ?1 ORDER BY id DESC LIMIT 50`)
    .bind(userId)
    .all<{ oldName: string; newName: string; at: string }>();
  return r.results ?? [];
}
