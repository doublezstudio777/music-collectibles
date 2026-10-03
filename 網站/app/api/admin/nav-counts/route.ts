import { json, requireAdmin } from "@/lib/server/auth";
import { adminNavCounts } from "@/lib/server/admin-counts";

/** 後台左側選單的待處理數字，一次回傳全部（2026-10-03）。?detail=1 多回細項，核對用。只有管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const { counts, detail } = await adminNavCounts();
  const withDetail = new URL(req.url).searchParams.get("detail") === "1";
  return json(withDetail ? { counts, detail } : { counts }, 200, { "Cache-Control": "no-store" });
}
