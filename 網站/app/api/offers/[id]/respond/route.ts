import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/trade";
import { respondOffer } from "@/lib/server/trade";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 賣家接受或拒絕：{ answer: accepted|rejected } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  void body;
  return handle(async () => {
    const id = await num(ctx.params, "id");
    const r = await respondOffer(s.user, id, body.answer);
    return json({ ok: true, ...(r === undefined ? {} : { result: r }) });
  });
}
