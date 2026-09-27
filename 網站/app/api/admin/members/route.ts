import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { MemberError, memberLog, searchMembers, setMemberStatus } from "@/lib/server/members";

/** 會員列表：?q=關鍵字（暱稱、Email、帳號）&status=active|suspended&page=1。不含私訊內容，只有對話數。只有管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const p = new URL(req.url).searchParams;
  const handle = p.get("log");
  if (handle) return json({ log: await memberLog(handle) }, 200, { "Cache-Control": "no-store" });
  const page = Math.max(1, Math.min(1000, Number(p.get("page")) || 1));
  return json(await searchMembers(p.get("q") ?? "", p.get("status") ?? "", page), 200, { "Cache-Control": "no-store" });
}

/** 停權／恢復：{ id, action: suspend|restore, reason }，寫操作紀錄 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  const reason = str(b.reason);
  if (b.action === "suspend" && !reason) return fail(400, "INVALID", "寫一下停權原因");
  try {
    const status = await setMemberStatus(s.user, str(b.id), str(b.action), reason);
    return json({ ok: true, status });
  } catch (e) {
    if (e instanceof MemberError) return fail(e.status, e.code, e.message);
    throw e;
  }
}
