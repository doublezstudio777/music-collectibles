import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { setThreshold } from "@/lib/server/moderation";

/** 調檢舉門檻：{ value } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    await setThreshold(s.user, b.value);
    return json({ ok: true });
  });
}
