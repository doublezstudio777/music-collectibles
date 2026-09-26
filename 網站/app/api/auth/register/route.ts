import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  clientIp, fail, handleProblem, json, normEmail, readBody, sendCode, str, userByEmail, userByHandle,
  validEmail, validPassword,
} from "@/lib/server/auth";
import { hashPassword, randomToken } from "@/lib/server/crypto";
import { hit, verifyTurnstile } from "@/lib/server/services";

/** 註冊：Email＋密碼＋帳號名＋顯示名稱。成功後寄 6 位數驗證碼，驗證完才算登入 */
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!(await verifyTurnstile(body.turnstileToken, clientIp(req)))) {
    return fail(400, "TURNSTILE_FAILED", "機器人驗證沒過，重新整理再試一次");
  }
  const email = normEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const handle = str(body.handle).toLowerCase();
  const name = str(body.name);
  if (!validEmail(email)) return fail(400, "INVALID_EMAIL", "Email 格式不對");
  if (!validPassword(password)) return fail(400, "WEAK_PASSWORD", "密碼至少 8 個字");
  const hp = handleProblem(handle);
  if (hp) return fail(400, "INVALID_HANDLE", hp);
  if (!name || name.length > 20) return fail(400, "INVALID_NAME", "顯示名稱 1～20 字");
  if (!(await hit(`register:${clientIp(req) ?? "local"}`, 10, 3600))) {
    return fail(429, "RATE_LIMITED", "註冊太多次了，一小時後再試");
  }
  if (await userByEmail(email)) return fail(409, "EMAIL_TAKEN", "這個 Email 已經註冊過，直接登入就好");
  if (await userByHandle(handle)) return fail(409, "HANDLE_TAKEN", "這個帳號名有人用了");

  const [user] = await getDb()
    .insert(users)
    .values({ id: randomToken(12), email, passwordHash: await hashPassword(password), handle, name })
    .returning();
  await sendCode(user, "verify");
  return json({ pending: "verify", email }, 201);
}
