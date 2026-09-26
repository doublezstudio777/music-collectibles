import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { fail, json, readBody, requireUser, validPassword } from "@/lib/server/auth";
import { hashPassword, verifyPassword } from "@/lib/server/crypto";
import { hit } from "@/lib/server/services";

/** 改密碼：{ current, password }。改完這台保持登入，其他裝置全部登出 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  if (!(await hit(`password:${s.user.id}`, 10, 900))) return fail(429, "RATE_LIMITED", "太多次了，15 分鐘後再試");
  const current = typeof b.current === "string" ? b.current : "";
  const next = typeof b.password === "string" ? b.password : "";
  if (!(await verifyPassword(current, s.user.passwordHash))) return fail(400, "WRONG_PASSWORD", "目前的密碼不對");
  if (!validPassword(next)) return fail(400, "INVALID", "新密碼至少 8 個字");
  const db = getDb();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next), updatedAt: new Date().toISOString() })
    .where(eq(users.id, s.user.id));
  await db.delete(sessions).where(and(eq(sessions.userId, s.user.id), ne(sessions.id, s.sessionId)));
  return json({ ok: true });
}
