import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { removeAvatar } from "@/lib/server/avatars";
import { handle } from "@/lib/server/trade";

/** 管理員移除某位會員的大頭貼：{ id（會員 id）, note? }。R2 檔刪掉、容量扣回、寫操作紀錄 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const [u] = await getDb().select().from(users).where(eq(users.id, str(b.id)));
  if (!u) return fail(404, "NOT_FOUND", "找不到這位會員");
  return handle(async () => json(await removeAvatar(u, new URL(req.url).origin, s.user, str(b.note).slice(0, 200))));
}
