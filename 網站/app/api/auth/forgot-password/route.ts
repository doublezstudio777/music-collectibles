import { clientIp, fail, json, normEmail, readBody, sendCode, userByEmail } from "@/lib/server/auth";
import { verifyTurnstile } from "@/lib/server/services";

/** 忘記密碼：寄重設碼。不管帳號在不在都回同一句 */
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!(await verifyTurnstile(body.turnstileToken, clientIp(req)))) {
    return fail(400, "TURNSTILE_FAILED", "機器人驗證沒過，重新整理再試一次");
  }
  const email = normEmail(body.email);
  const user = email ? await userByEmail(email) : null;
  if (user && user.status === "active") await sendCode(user, "reset");
  return json({ ok: true });
}
