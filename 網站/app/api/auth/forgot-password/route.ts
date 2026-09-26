import { clientIp, fail, json, normEmail, readBody, sendCode, userByEmail, validEmail } from "@/lib/server/auth";
import { hit, verifyTurnstile } from "@/lib/server/services";

/**
 * 忘記密碼：寄重設碼。不管帳號在不在都回同一句。
 * 頻率限制（2b）：每個 IP 每小時 10 次、每個 Email 每小時 5 次。
 * 同一個 Email 的限制不看帳號存不存在，所以 429 也不會洩露有沒有這個帳號。
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const ip = clientIp(req) ?? "unknown";
  if (!(await hit(`forgot-ip:${ip}`, 10, 3600))) {
    return fail(429, "RATE_LIMITED", "太多次了，一小時後再試");
  }
  const email = normEmail(body.email);
  if (email && validEmail(email) && !(await hit(`forgot-email:${email}`, 5, 3600))) {
    return fail(429, "RATE_LIMITED", "這個 Email 太多次了，一小時後再試");
  }
  if (!(await verifyTurnstile(body.turnstileToken, clientIp(req)))) {
    return fail(400, "TURNSTILE_FAILED", "機器人驗證沒過，重新整理再試一次");
  }
  const user = email ? await userByEmail(email) : null;
  if (user && user.status === "active") await sendCode(user, "reset");
  return json({ ok: true });
}
