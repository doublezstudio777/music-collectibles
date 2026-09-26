import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { setDisplay } from "@/lib/server/takedown";

/** 藝人頁顯示：{ slug, mode: auto|on|off } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await setDisplay(s.user, b.slug, b.mode)));
}
