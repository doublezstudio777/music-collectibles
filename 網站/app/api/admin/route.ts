import { json, requireAdmin } from "@/lib/server/auth";
import { adminOverview } from "@/lib/server/moderation";

/** 管理後台總覽：檢舉、申訴、待審核新增、門檻、操作紀錄。只有管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json(await adminOverview(s.user));
}
