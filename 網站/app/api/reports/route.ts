import { json, readBody, requireUser } from "@/lib/server/auth";
import { errorReport, report } from "@/lib/server/moderation";
import { reportComment } from "@/lib/server/comments";
import { handle } from "@/lib/server/trade";

const ERROR_REASONS = ["wrong_info", "not_artist", "duplicate", "other"];

/**
 * 檢舉：{ target: share:{n}|item:{鍵}|version:{鍵}, reason, note, photoId? }。只有認證帳號、一人一次
 * 單則頁「對這則收藏有疑問嗎？」（2026-09-28）：target＝share:{n} 且 reason 是 wrong_info｜not_artist｜duplicate｜other
 *   → 錯誤回報（error_reports），不計鎖定門檻、不算分；fake｜scam｜improper → 檢舉，照原規則
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
  if (typeof b.target === "string" && /^share:\d{1,9}$/.test(b.target) && ERROR_REASONS.includes(String(b.reason))) {
    const no = Number(b.target.slice(6));
    return handle(async () => json({ kind: "error", ...(await errorReport(s.user, no, b.reason, b.note, b.photoId)) }, 201));
  }
  return handle(async () => json({ kind: "report", ...(await report(s.user, b.target, b.reason, b.note, b.photoId)) }, 201));
}
