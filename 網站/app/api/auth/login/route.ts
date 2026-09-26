import {
  clearHits, hit, verifyTurnstile,
} from "@/lib/server/services";
import { clientIp, fail, loginResponse, normEmail, readBody, sendCode, userByEmail } from "@/lib/server/auth";
import { burnPasswordTime, verifyPassword } from "@/lib/server/crypto";

/** 登入。body.client = "app" 時 token 放 body（App 用 Bearer），否則寫 HttpOnly cookie */
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!(await verifyTurnstile(body.turnstileToken, clientIp(req)))) {
    return fail(400, "TURNSTILE_FAILED", "機器人驗證沒過，重新整理再試一次");
  }
  const email = normEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const client = body.client === "app" ? "app" : "web";
  const key = `login:${email}`;
  if (!(await hit(key, 10, 900))) return fail(429, "RATE_LIMITED", "錯太多次了，15 分鐘後再試");

  const user = email ? await userByEmail(email) : null;
  if (!user) {
    await burnPasswordTime(password);
    return fail(401, "INVALID_CREDENTIALS", "Email 或密碼不對");
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return fail(401, "INVALID_CREDENTIALS", "Email 或密碼不對");
  }
  if (user.status !== "active") return fail(403, "SUSPENDED", "這個帳號暫停使用中");
  if (!user.emailVerifiedAt) {
    const sent = await sendCode(user, "verify");
    return fail(403, "EMAIL_UNVERIFIED", "這個 Email 還沒驗證，驗證碼已寄出", {
      email: user.email,
      ...(sent.ok ? {} : { wait: sent.wait }),
    });
  }
  await clearHits(key);
  return loginResponse(user, req, client);
}
