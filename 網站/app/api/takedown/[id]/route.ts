import { fail, json, requireUser } from "@/lib/server/auth";
import { noticeForMember } from "@/lib/server/copyright";
import { handle } from "@/lib/server/trade";

/** 被通知的會員看通知內容（不含通知人的聯絡方式） */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail(404, "NOT_FOUND", "找不到這則通知");
  return handle(async () => json({ notice: await noticeForMember(s.user, id) }, 200, { "Cache-Control": "no-store" }));
}
