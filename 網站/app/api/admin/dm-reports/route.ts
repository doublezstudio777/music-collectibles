import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { adminDmReports, handleDmReport, setDmDailyLimit } from "@/lib/server/dm";

/** 私訊檢舉清單與每日開新對話上限（不含訊息內容）。只有管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json(await adminDmReports());
}

/** 調上限：{ limit }；處理檢舉：{ id, status: done|open } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    if (b.limit !== undefined) await setDmDailyLimit(s.user, b.limit);
    else await handleDmReport(s.user, b.id, b.status);
    return json({ ok: true });
  });
}
