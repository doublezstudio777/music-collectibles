import { json, readBody, requireUser } from "@/lib/server/auth";
import { submitContent } from "@/lib/server/moderation";
import { handle } from "@/lib/server/trade";

/**
 * 「這裡沒有，我要新增」：{ type: artist|series|item|version, ... }。
 * 送出後是待審核，管理員在後台核准才出現。
 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await submitContent(s.user, b.type, b), 201));
}
