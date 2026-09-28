import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { adminErrorReports, handleErrorReport } from "@/lib/server/moderation";
import { handle } from "@/lib/server/trade";

/** 後台「錯誤回報」：待處理全部＋最近處理過的 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ list: await adminErrorReports() }, 200, { "Cache-Control": "no-store" });
}

/** { id, action: fixed｜ignored｜reopen }，寫操作紀錄 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "BAD_REQUEST", "參數不對");
  return handle(async () => {
    await handleErrorReport(s.user, id, str(b.action));
    return json({ ok: true });
  });
}
