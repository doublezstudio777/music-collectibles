import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle, HttpError, reportThreadOf } from "@/lib/server/trade";

/** 檢舉對話的另一方：{ reason: harass|scam|spam|other, note }。一人一條對話一次，後台看不到訊息內容 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "NOT_FOUND", "找不到這段對話");
    await reportThreadOf(s.user, id, b.reason, b.note);
    return json({ ok: true }, 201);
  });
}
