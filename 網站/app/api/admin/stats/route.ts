import { json, requireAdmin } from "@/lib/server/auth";
import { adminOverview } from "@/lib/server/moderation";
import { dashboardStats } from "@/lib/server/stats";
import { detectDuplicatePairs } from "@/lib/server/duplicates";
import { pendingDeletionCount } from "@/lib/server/deletion";
import { pendingArtistPhotoCount } from "@/lib/server/artist-photos";
import { openErrorReportCount } from "@/lib/server/moderation";
import { openFeedbackCount } from "@/lib/server/feedback";

/**
 * 儀表板：統計（10 分鐘快取，?fresh=1 重算）＋待處理佇列（每次即時）。只有管理員。
 * 佇列跟 /admin/moderation 同一份資料（adminOverview），數字一定對得上。
 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const url = new URL(req.url);
  const [{ stats, cached }, o, dups] = await Promise.all([
    dashboardStats(url.origin, url.searchParams.get("fresh") === "1"),
    adminOverview(s.user),
    detectDuplicatePairs(),
  ]);
  const queue = {
    pending: o.pending.length,
    reports: o.targets.filter((t) => t.total > 0 && t.decision === null).length,
    appeals: o.appeals.filter((a) => a.status === "pending").length,
    locked: o.targets.filter((t) => t.locked).length,
    hidden: o.hidden.length,
    comments: o.comments.list.length,
    commentsHidden: o.comments.list.filter((c) => c.hidden).length,
    duplicates: dups.length,
    avatars: o.avatars.length,
    deletions: await pendingDeletionCount(),
    artistPhotos: await pendingArtistPhotoCount(),
    // 錯誤回報（2026-09-28）：不計入檢舉門檻，另外一個佇列
    errorReports: await openErrorReportCount(),
    // 意見回饋（2026-09-29）：未處理件數
    feedback: await openFeedbackCount(),
  };
  return json({ stats, cached, queue }, 200, { "Cache-Control": "no-store" });
}
