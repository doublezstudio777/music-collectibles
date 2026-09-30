import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { openDirect } from "@/lib/server/dm";

/** 個人頁「傳訊息」：開（或找回）跟這位會員的直接私訊，回傳 result＝對話 id */
export async function POST(req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  await readBody(req);
  return handle(async () => json({ ok: true, result: await openDirect(s.user, (await ctx.params).handle) }));
}
