import { json, requireUser } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { handle, HttpError, publicOffers, threadDetail } from "@/lib/server/trade";

/** 一段對話＋那則收藏的現況（出售狀態、鎖定）。讀了就標已讀 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return handle(async () => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "NOT_FOUND", "找不到這段對話");
    const t = await threadDetail(s.user, id);
    const c = await getCatalog(s.user.id);
    const share = c.getShare(t.shareNo);
    if (!share) throw new HttpError(404, "NOT_FOUND", "這則收藏已經不在了");
    return json({ thread: t, share: c.toShareView(share), offers: await publicOffers(t.shareNo) });
  });
}
