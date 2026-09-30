import { requireConsented } from "@/lib/server/terms";
import { json, readBody } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/trade";
import { respondOffer } from "@/lib/server/trade";
import { tradeBlocked } from "@/lib/server/geo";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 賣家接受或拒絕：{ answer: accepted|rejected } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  // 接受要在台灣；拒絕不算交易，海外也可以
  if (body.answer === "accepted") {
    const blocked = tradeBlocked(req);
    if (blocked) return blocked;
  }
  return handle(async () => {
    const id = await num(ctx.params, "id");
    const r = await respondOffer(s.user, id, body.answer);
    return json({ ok: true, ...(r === undefined ? {} : { result: r }) });
  });
}
