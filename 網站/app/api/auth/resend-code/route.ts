import { clientIp, fail, json, normEmail, readBody, sendCode, userByEmail } from "@/lib/server/auth";
import { hit } from "@/lib/server/services";

/** 重寄驗證信箱的碼。帳號不存在或已驗證也回 ok，不透露帳號狀態 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const email = normEmail(body.email);
  if (!(await hit(`resend:${clientIp(req) ?? "local"}`, 20, 3600))) {
    return fail(429, "RATE_LIMITED", "寄太多次了，一小時後再試");
  }
  const user = email ? await userByEmail(email) : null;
  if (user && !user.emailVerifiedAt) {
    const sent = await sendCode(user, "verify");
    if (!sent.ok) return fail(429, "COOLDOWN", `${sent.wait} 秒後才能再寄`, { wait: sent.wait });
  }
  return json({ ok: true });
}
