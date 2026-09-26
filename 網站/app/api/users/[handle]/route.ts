import { fail, json, userByHandle } from "@/lib/server/auth";
import { publicHoldings } from "@/lib/server/me";

/** 公開個人資料：名稱、簡介、是否認證、我有／想要。追蹤與點讚不公開 */
export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const u = await userByHandle(handle.toLowerCase());
  if (!u || u.status !== "active") return fail(404, "NOT_FOUND", "找不到這個使用者");
  return json({
    user: { handle: u.handle, name: u.name, bio: u.bio, verified: Boolean(u.emailVerifiedAt) },
    ...(await publicHoldings(u.id)),
  });
}
