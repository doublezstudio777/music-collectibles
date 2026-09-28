import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { reviewSubmission } from "@/lib/server/moderation";

/** 核准或退回使用者送出的新增：{ type, id, approve } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    // 系列核准時，等這個系列的收藏會自動改掛過去（movedShares＝改掛幾則）
    const r = await reviewSubmission(s.user, b.type, b.id, b.approve);
    return json({ ok: true, ...r });
  });
}
