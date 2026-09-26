import { json, requireAdmin } from "@/lib/server/auth";
import { indexingAllowed, siteStatus } from "@/lib/server/guard";
import { storageUsed, STORAGE_LIMIT } from "@/lib/server/photos";
import { mailerMode, passwordIterations } from "@/lib/server/services";

/**
 * 部署後檢查用（只有管理員）：Worker 看到的來源 IP、是否經過 Cloudflare、寄信模式、收錄開關、容量與讀取計數。
 * 用法見 產出/20260927_部署手冊.md「部署後檢查」。
 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const cf = (req as Request & { cf?: { colo?: string; country?: string } }).cf;
  const { status } = await siteStatus();
  return json(
    {
      ip: req.headers.get("cf-connecting-ip"),
      xForwardedFor: req.headers.get("x-forwarded-for"),
      colo: cf?.colo ?? null,
      country: cf?.country ?? null,
      mailer: mailerMode(),
      indexing: indexingAllowed() ? "open" : "noindex",
      pbkdf2Iterations: passwordIterations(),
      storage: { used: await storageUsed(), limit: STORAGE_LIMIT },
      photoReads: { month: status.reads, limit: status.readLimit },
      paused: status.paused,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
