import { json, readBody, requireUser } from "@/lib/server/auth";
import { submitAppeal } from "@/lib/server/moderation";
import { handle } from "@/lib/server/trade";

/** 申訴：{ target, text, photoIds }。只有被鎖的收藏的發文者，審核中不能重送 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    await submitAppeal(s.user, b.target, b.text, b.photoIds);
    return json({ ok: true }, 201);
  });
}
