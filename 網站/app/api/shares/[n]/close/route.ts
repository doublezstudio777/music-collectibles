import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/trade";
import { closeDeal } from "@/lib/server/trade";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 成交給接受過的出價：{ offerId }（作者） */
export async function POST(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  void body;
  return handle(async () => {
    const id = await num(ctx.params, "n");
    const r = await closeDeal(s.user, id, body.offerId);
    return json({ ok: true, ...(r === undefined ? {} : { result: r }) });
  });
}
