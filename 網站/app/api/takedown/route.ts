import { clientIp, fail, json, readBody } from "@/lib/server/auth";
import { submitNotice } from "@/lib/server/copyright";
import { verifyTurnstile } from "@/lib/server/services";
import { handle } from "@/lib/server/trade";

/**
 * 權利侵害通知（2026-10-01，使用條款第 11 條）：{ name, email, phone?, address?, role, rightType, work, urls, detail, sworn, turnstileToken }。
 * 不用登入；Turnstile 一律要過，每個 IP 每小時 5 則
 */
export async function POST(req: Request) {
  const b = await readBody(req);
  if (!(await verifyTurnstile(b.turnstileToken, clientIp(req)))) {
    return fail(400, "TURNSTILE_FAILED", "機器人驗證沒過，重新整理再試一次");
  }
  return handle(async () => json(await submitNotice(clientIp(req), b), 201));
}
