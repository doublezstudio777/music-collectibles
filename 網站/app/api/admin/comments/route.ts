import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { moderateComment, setCommentThreshold } from "@/lib/server/comments";
import { handle } from "@/lib/server/trade";

/** 留言處理：{ id, action: restore|delete }；調門檻：{ threshold }。只有管理員 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    if (b.threshold !== undefined) await setCommentThreshold(s.user, b.threshold);
    else await moderateComment(s.user, b.id, b.action);
    return json({ ok: true });
  });
}
