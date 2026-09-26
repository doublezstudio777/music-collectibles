import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/trade";
import { withdrawOffer } from "@/lib/server/trade";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 買家撤回自己還在等回覆的出價 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  void body;
  return handle(async () => {
    const id = await num(ctx.params, "id");
    const r = await withdrawOffer(s.user, id);
    return json({ ok: true, ...(r === undefined ? {} : { result: r }) });
  });
}
