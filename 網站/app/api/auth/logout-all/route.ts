import { clearCookie, destroyAllSessions, json, requireUser } from "@/lib/server/auth";

/** 登出所有裝置（含這台） */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  await destroyAllSessions(s.user.id);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(req) });
}
