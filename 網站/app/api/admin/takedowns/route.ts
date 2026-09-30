import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { adminNotices, handleNotice } from "@/lib/server/copyright";
import { handle } from "@/lib/server/trade";

/** 後台「侵權通知」：處理中全部＋最近 50 筆 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ list: await adminNotices() }, 200, { "Cache-Control": "no-store" });
}

/** { id, action, note? }，見 lib/server/copyright.ts 的 handleNotice */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "BAD_REQUEST", "參數不對");
  return handle(async () => json(await handleNotice(s.user, id, str(b.action), b.note, new URL(req.url).origin)));
}
