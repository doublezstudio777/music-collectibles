import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { purge } from "@/lib/server/takedown";

/** 永久刪除空頁面：{ type: artist|series|item|version, key }。底下有收藏一律 409 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await purge(s.user, b.type, b.key)));
}
