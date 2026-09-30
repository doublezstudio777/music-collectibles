import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { myBlocks, setBlock } from "@/lib/server/dm";

/** 我封鎖的會員 */
export async function GET(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return json({ blocks: await myBlocks(s.user) });
}

/** 封鎖／解除：{ handle, blocked: true|false } */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    await setBlock(s.user, b.handle, b.blocked);
    return json({ ok: true });
  });
}
