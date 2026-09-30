import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { submitCounter } from "@/lib/server/copyright";
import { handle } from "@/lib/server/trade";

/** 回復通知：{ text, sworn }。只有被通知的會員、內容已移除（status=removed）時能送 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const b = await readBody(req);
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail(404, "NOT_FOUND", "找不到這則通知");
  return handle(async () => json(await submitCounter(s.user, id, b)));
}
