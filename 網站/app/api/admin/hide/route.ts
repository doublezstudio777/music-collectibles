import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { setHidden } from "@/lib/server/takedown";

/** 隱藏／恢復：{ type: artist|series|item|version|share, key, hidden } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await setHidden(s.user, b.type, b.key, b.hidden)));
}
