import { json, readBody, requireUser } from "@/lib/server/auth";
import { report } from "@/lib/server/moderation";
import { reportComment } from "@/lib/server/comments";
import { handle } from "@/lib/server/trade";

/**
 * 檢舉：{ target: share:{n}|item:{鍵}|version:{鍵}, reason: fake|never|other, note }。只有認證帳號、一人一次
 * 留言（2026-09-28）：{ target: comment:{id}, reason: scam|abuse|other }，存 comment_reports，達門檻自動隱藏
 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  if (typeof b.target === "string" && b.target.startsWith("comment:")) {
    const t = b.target;
    return handle(async () => json(await reportComment(s.user, t, b.reason, b.note), 201));
  }
  return handle(async () => json(await report(s.user, b.target, b.reason, b.note), 201));
}
