import { json, requireUser } from "@/lib/server/auth";
import { deleteComment } from "@/lib/server/comments";
import { handle } from "@/lib/server/trade";

/** 刪留言：留言者自己、該則收藏的發文者、管理員 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const id = Number((await params).id);
  return handle(async () => {
    await deleteComment(s.user, id);
    return json({ ok: true });
  });
}
