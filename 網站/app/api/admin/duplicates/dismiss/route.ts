import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { dismissDuplicate } from "@/lib/server/duplicates";

/** 標「不是重複」：{ a, b }，之後這組不再列出 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await dismissDuplicate(s.user, b.a, b.b)));
}
