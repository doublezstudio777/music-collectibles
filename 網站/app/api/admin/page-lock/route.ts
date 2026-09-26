import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { setPageLock } from "@/lib/server/wiki";

/** 鎖定／解除頁面編輯：{ target, locked } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    await setPageLock(s.user, b.target, b.locked);
    return json({ ok: true, locked: b.locked });
  });
}
