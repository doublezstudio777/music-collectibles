import { passwordIterations } from "@/lib/server/services";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  checkCode, destroyAllSessions, fail, loginResponse, normEmail, readBody, str, userByEmail, validPassword,
} from "@/lib/server/auth";
import { hashPassword } from "@/lib/server/crypto";

/** 重設密碼：Email＋重設碼＋新密碼。成功後其他裝置全部登出，這台直接登入 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const email = normEmail(body.email);
  const code = str(body.code);
  const password = typeof body.password === "string" ? body.password : "";
  const client = body.client === "app" ? "app" : "web";
  if (!validPassword(password)) return fail(400, "WEAK_PASSWORD", "密碼至少 8 個字");
  const user = email ? await userByEmail(email) : null;
  if (!user || !/^\d{6}$/.test(code)) return fail(400, "CODE_INVALID", "驗證碼不對");
  const r = await checkCode(user, "reset", code);
  if (r === "expired") return fail(400, "CODE_EXPIRED", "驗證碼過期或錯太多次，重新申請一組");
  if (r === "wrong") return fail(400, "CODE_INVALID", "驗證碼不對");
  const now = new Date().toISOString();
  const [updated] = await getDb()
    .update(users)
    // 重設碼寄到信箱也證明了信箱是本人的
    .set({ passwordHash: await hashPassword(password, passwordIterations()), emailVerifiedAt: user.emailVerifiedAt ?? now, updatedAt: now })
    .where(eq(users.id, user.id))
    .returning();
  await destroyAllSessions(user.id);
  return loginResponse(updated, req, client);
}
