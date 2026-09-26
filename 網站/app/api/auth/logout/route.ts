import { clearCookie, destroySession, json, requireUser } from "@/lib/server/auth";

export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return json({ ok: true }, 200, { "Set-Cookie": clearCookie(req) });
  await destroySession(s.sessionId);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(req) });
}
