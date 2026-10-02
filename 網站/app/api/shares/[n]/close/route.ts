import { requireConsented } from "@/lib/server/terms";
import { json, readBody } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/trade";
import { closeDeal } from "@/lib/server/trade";
import { tradeBlocked } from "@/lib/server/geo";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 成交給接受過的出價：{ offerId }（作者） */
export async function POST(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  // 先把 body 讀完再回應（沒讀完就回 403，本機 Miniflare 同一條連線的下一個請求會 503）
  const body = await readBody(req);
  const blocked = tradeBlocked(req);
  if (blocked) return blocked;
  void body;
  return handle(async () => {
    const id = await num(ctx.params, "n");
    const r = await closeDeal(s.user, id, body.offerId);
    return json({ ok: true, ...(r === undefined ? {} : { result: r }) });
  });
}
