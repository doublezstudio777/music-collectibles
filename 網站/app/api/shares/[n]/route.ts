import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/trade";
import { getCatalog } from "@/lib/server/content";
import { getViewer } from "@/lib/server/viewer";
import { publicOffers, setSale } from "@/lib/server/trade";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 單則：內容＋公開出價列表 */
export async function GET(_req: Request, ctx: { params: Promise<{ n: string }> }) {
  return handle(async () => {
    const n = await num(ctx.params, "n");
    const viewer = await getViewer();
    const c = await getCatalog(viewer?.id ?? null);
    const s = c.getShare(n);
    if (!s) throw new HttpError(404, "NOT_FOUND", "找不到這則收藏");
    return json({ share: c.toShareView(s), offers: await publicOffers(n) });
  });
}

/** 作者改出售狀態：{ state: share|offer|sale, price? } */
export async function PATCH(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  return handle(async () => {
    await setSale(s.user, await num(ctx.params, "n"), body.state, body.price);
    return json({ ok: true });
  });
}
