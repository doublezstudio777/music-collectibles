import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { adminFeedback, handleFeedback } from "@/lib/server/feedback";
import { handle } from "@/lib/server/trade";

/** 後台「意見回饋」：未處理全部＋最近處理過的 50 筆 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ list: await adminFeedback() }, 200, { "Cache-Control": "no-store" });
}

/** { id, action: done｜reopen｜note, note? }，寫操作紀錄 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "BAD_REQUEST", "參數不對");
  return handle(async () => {
    await handleFeedback(s.user, id, str(b.action), b.note);
    return json({ ok: true });
  });
}
