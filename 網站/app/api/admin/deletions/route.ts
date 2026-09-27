import { json, requireAdmin } from "@/lib/server/auth";
import { deletionList } from "@/lib/server/deletion";

/** 刪帳申請：待處理＋最近 30 筆已處理。只有管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ list: await deletionList() }, 200, { "Cache-Control": "no-store" });
}
