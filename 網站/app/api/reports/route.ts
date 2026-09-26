import { json, readBody, requireUser } from "@/lib/server/auth";
import { report } from "@/lib/server/moderation";
import { handle } from "@/lib/server/trade";

/** 檢舉：{ target: share:{n}|item:{鍵}|version:{鍵}, reason: fake|never|other, note }。只有認證帳號、一人一次 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await report(s.user, b.target, b.reason, b.note), 201));
}
