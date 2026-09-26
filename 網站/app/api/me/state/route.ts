import { json, requireUser } from "@/lib/server/auth";
import { myState } from "@/lib/server/me";

/** 一次拿回點讚、我有、想要、追蹤 */
export async function GET(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return json(await myState(s.user.id), 200, { "Cache-Control": "no-store" });
}
