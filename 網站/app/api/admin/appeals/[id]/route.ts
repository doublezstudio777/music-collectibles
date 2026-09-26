import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { decideAppeal } from "@/lib/server/moderation";

/** 裁決申訴：{ decision: unlocked|kept } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    await decideAppeal(s.user, Number((await ctx.params).id), b.decision);
    return json({ ok: true });
  });
}
