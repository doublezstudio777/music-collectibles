import { env } from "cloudflare:workers";
import { clientIp, fail, json } from "@/lib/server/auth";
import { safeEqual, setPaused } from "@/lib/server/guard";
import { hit } from "@/lib/server/services";

/**
 * 零花費第三道防線：預算通知 webhook。共用密鑰放在 cf-webhook-auth 表頭（Cloudflare 通知 webhook 的做法）。
 * 驗過 → 網站進入暫停模式（停上傳、停讀照片、文字照常），管理員在 /admin 解除。
 * 沒設 BUDGET_WEBHOOK_SECRET 時整支關閉。
 */
export async function POST(req: Request) {
  const secret = env.BUDGET_WEBHOOK_SECRET;
  if (!secret) return fail(503, "DISABLED", "webhook 未設定");
  if (!(await hit(`webhook:${clientIp(req) ?? "unknown"}`, 30, 3600))) return fail(429, "RATE_LIMITED", "太頻繁");
  const got = req.headers.get("cf-webhook-auth") ?? "";
  if (!got || !safeEqual(got, secret)) return fail(401, "BAD_SECRET", "密鑰不對");
  const text = (await req.text().catch(() => "")).slice(0, 1000);
  await setPaused(true, "system", "預算通知 webhook", { body: text });
  return json({ ok: true, paused: true });
}
