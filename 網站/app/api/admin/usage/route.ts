import { json, requireAdmin } from "@/lib/server/auth";
import { usage } from "@/lib/server/usage";

/** 用量與花費：R2 容量、本月照片讀取、暫停模式、Cloudflare Analytics（沒設金鑰顯示未設定）。只有管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json(await usage(), 200, { "Cache-Control": "no-store" });
}
