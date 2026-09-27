import { json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { executeDeletion } from "@/lib/server/deletion";
import { handle } from "@/lib/server/trade";

/**
 * 執行刪除帳號：{ id（申請編號）, deletePhotos: boolean, confirm（要等於會員帳號名） }。
 * 不能還原；寫操作紀錄「執行刪除帳號」
 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return handle(async () => json(await executeDeletion(s.user, Number(b.id), b.deletePhotos === true, str(b.confirm), new URL(req.url).origin)));
}
