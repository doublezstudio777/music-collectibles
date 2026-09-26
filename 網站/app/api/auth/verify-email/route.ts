import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { checkCode, fail, loginResponse, normEmail, readBody, str, userByEmail } from "@/lib/server/auth";

/** 驗證信箱：Email＋6 位數碼。成功就直接登入 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const email = normEmail(body.email);
  const code = str(body.code);
  const client = body.client === "app" ? "app" : "web";
  const user = email ? await userByEmail(email) : null;
  if (!user || user.emailVerifiedAt || !/^\d{6}$/.test(code)) {
    return fail(400, "CODE_INVALID", "驗證碼不對");
  }
  const r = await checkCode(user, "verify", code);
  if (r === "expired") return fail(400, "CODE_EXPIRED", "驗證碼過期或錯太多次，重寄一組");
  if (r === "wrong") return fail(400, "CODE_INVALID", "驗證碼不對");
  const now = new Date().toISOString();
  const [verified] = await getDb()
    .update(users)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(eq(users.id, user.id))
    .returning();
  return loginResponse(verified, req, client);
}
