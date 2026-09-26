import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { setDecision } from "@/lib/server/moderation";

/** 直接裁決某個對象：{ target, decision: unlocked|kept|clear } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    await setDecision(s.user, b.target, b.decision);
    return json({ ok: true });
  });
}
