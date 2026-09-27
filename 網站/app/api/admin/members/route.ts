import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { MemberError, memberLog, nameHistory, searchMembers, setMemberLevel, setMemberStatus } from "@/lib/server/members";

/** 會員列表：?q=關鍵字（暱稱、Email、帳號）&status=active|suspended&page=1。不含私訊內容，只有對話數。只有管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const p = new URL(req.url).searchParams;
  const handle = p.get("log");
  if (handle) return json({ log: await memberLog(handle) }, 200, { "Cache-Control": "no-store" });
  // 改名紀錄（2026-09-28）：?names={會員 id}
  const names = p.get("names");
  if (names) return json({ names: await nameHistory(names) }, 200, { "Cache-Control": "no-store" });
  const page = Math.max(1, Math.min(1000, Number(p.get("page")) || 1));
  return json(await searchMembers(p.get("q") ?? "", p.get("status") ?? "", page), 200, { "Cache-Control": "no-store" });
}

/**
 * 停權／恢復：{ id, action: suspend|restore, reasonCode, note }；只帶 reason（舊格式）＝原因「其他」＋說明
 * 指定等級：{ id, action: set_level, level: 1～25, reason }；取消指定：{ id, action: clear_level, reason? }。都寫操作紀錄
 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  try {
    if (b.action === "set_level" || b.action === "clear_level") {
      const level = b.action === "set_level" ? Number(b.level) : null;
      return json({ ok: true, level: await setMemberLevel(s.user, str(b.id), level, str(b.reason)) });
    }
    const code = str(b.reasonCode) || (str(b.reason) ? "other" : "");
    const note = str(b.note) || (str(b.reasonCode) ? "" : str(b.reason));
    const status = await setMemberStatus(s.user, str(b.id), str(b.action), code, note);
    return json({ ok: true, status });
  } catch (e) {
    if (e instanceof MemberError) return fail(e.status, e.code, e.message);
    throw e;
  }
}
