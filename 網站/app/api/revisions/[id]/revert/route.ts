import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { revert } from "@/lib/server/wiki";

/** 還原到這一版：{ summary?（補充說明） }，會新增一筆紀錄 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 1) return fail(400, "BAD_REQUEST", "參數不對");
  const b = await readBody(req);
  return handle(async () => json(await revert(s.user, id, b.summary), 201));
}
