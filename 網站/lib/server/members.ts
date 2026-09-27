// 管理後台：會員管理（2026-09-28）。
// 不看私訊內容：只算對話數（當買家或賣家的對話條數），不讀 messages 表。
// 停權：status=suspended、登出所有裝置（刪 sessions），登入時 userByToken 會擋；內容不自動隱藏（要隱藏另外用下架）。
// 恢復：status=active。兩者都寫 admin_log。管理員帳號（ADMIN_EMAILS）與自己不能停權。

import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { adminLog, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { destroyAllSessions, isAdmin, type User } from "@/lib/server/auth";
import { regionNames } from "@/lib/server/geo";

export const PAGE_SIZE = 50;

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
};

export async function searchMembers(query: string, status: string, page: number) {
  const db = env.DB!;
  const q = query.trim().toLowerCase().slice(0, 60);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const st = status === "active" || status === "suspended" ? status : "";
  const where = `WHERE (?1 = '' OR lower(u.name) LIKE ?2 ESCAPE '\\' OR u.email LIKE ?2 ESCAPE '\\' OR u.handle LIKE ?2 ESCAPE '\\') AND (?3 = '' OR u.status = ?3)`;
  const [list, total] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.name, u.handle, u.email, u.created_at AS createdAt, u.email_verified_at AS verifiedAt, u.status,
                u.deletion_requested_at AS delReq,
                (SELECT COUNT(*) FROM shares s WHERE s.author_id = u.id AND s.deleted_at IS NULL) AS posts,
                (SELECT COUNT(*) FROM deals d WHERE d.voided_at IS NULL AND (d.seller_id = u.id OR d.buyer_id = u.id)) AS deals,
                (SELECT COUNT(*) FROM reports r JOIN shares s2 ON r.target = 'share:' || s2.no WHERE s2.author_id = u.id) AS reported,
                (SELECT COUNT(*) FROM threads t JOIN shares s3 ON s3.no = t.share_no WHERE t.buyer_id = u.id OR s3.author_id = u.id) AS threads
         FROM users u ${where} ORDER BY u.created_at DESC LIMIT ?4 OFFSET ?5`,
      )
      .bind(q, like, st, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    db.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(q, like, st),
  ]);
  const rows = list.results as {
    id: string; name: string; handle: string; email: string; createdAt: string; verifiedAt: string | null; status: string;
    delReq: string | null; posts: number; deals: number; reported: number; threads: number;
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

export async function setMemberStatus(admin: User, id: string, action: string, reason: string) {
  if (action !== "suspend" && action !== "restore") throw new MemberError(400, "BAD_REQUEST", "參數不對");
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new MemberError(404, "NOT_FOUND", "找不到這位會員");
  if (u.id === admin.id || isAdmin(u)) throw new MemberError(403, "FORBIDDEN", "管理員帳號不能停權");
  const to = action === "suspend" ? "suspended" : "active";
  if (u.status === to) throw new MemberError(409, "UNCHANGED", action === "suspend" ? "這位已經停權" : "這位沒有被停權");
  await db.update(users).set({ status: to, updatedAt: new Date().toISOString() }).where(eq(users.id, id));
  if (to === "suspended") await destroyAllSessions(id);
  await db.insert(adminLog).values({
    adminId: admin.id,
    action: to === "suspended" ? "停權會員" : "恢復會員",
    target: `user:${u.handle}`,
    detail: JSON.stringify({ reason: reason.slice(0, 200) }),
  });
  return to;
}

/** 某位會員的停權／恢復紀錄 */
export async function memberLog(handle: string) {
  const r = await env
    .DB!.prepare(`SELECT action, detail, created_at AS at FROM admin_log WHERE target = ?1 ORDER BY id DESC LIMIT 20`)
    .bind(`user:${handle}`)
    .all();
  return r.results as { action: string; detail: string; at: string }[];
}
