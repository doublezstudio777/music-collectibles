// 後台左側選單的待處理數字（2026-10-03）。一次一個 D1 batch 算完，/api/admin/nav-counts 回傳。
//
// 原則：數字＝該頁列出、而且還要管理員動手的那幾筆。每一項的條件跟該頁的清單函式同一套，改清單條件要一起改：
// - moderation：待審核新增＋待裁決檢舉（有人檢舉、還沒裁決，不含大頭貼）＋待處理申訴＋被檢舉的留言＋被檢舉的大頭貼
//   （lib/server/moderation.ts adminOverview、lib/server/comments.ts adminComments；儀表板「待處理」同一套）
// - dmReports：私訊檢舉頁列最近 300 筆，其中「待處理」
// - takedowns：侵權通知「待處理」＋「會員提出回復通知」（openNoticeCount；已移除、已轉送是在等對方，不算）
// - errorReports／feedback／deletions／artistPhotos：各頁的「待處理／未處理／待審投稿」區
// - additions：待確認的新增頁列最近 300 筆，其中還沒確認的
// - duplicates：疑似重複藝人頁的清單（detectDuplicatePairs，跟頁面同一支）
import { env } from "cloudflare:workers";
import type { AdminCounts } from "@/lib/admin-nav";
import { detectDuplicatePairs } from "@/lib/server/duplicates";

const Q = {
  pending: `SELECT
      (SELECT COUNT(*) FROM artists WHERE status = 'pending')
    + (SELECT COUNT(*) FROM series WHERE status = 'pending')
    + (SELECT COUNT(*) FROM items i JOIN series s ON s.id = i.series_id WHERE i.status = 'pending')
    + (SELECT COUNT(*) FROM versions v JOIN items i ON i.id = v.item_ref JOIN series s ON s.id = i.series_id WHERE v.status = 'pending') AS n`,
  reports: `SELECT COUNT(DISTINCT target) AS n FROM reports
    WHERE target NOT LIKE 'avatar:%' AND target NOT IN (SELECT target FROM target_decisions)`,
  appeals: `SELECT COUNT(*) AS n FROM appeals WHERE status = 'pending'`,
  comments: `SELECT COUNT(*) AS n FROM (SELECT c.id FROM comments c WHERE c.deleted_at IS NULL
    AND (c.hidden_at IS NOT NULL OR (c.decision IS NULL AND EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id)))
    ORDER BY c.id LIMIT 200)`,
  avatars: `SELECT COUNT(*) AS n FROM photos p JOIN users u ON u.id = p.owner_id
    WHERE p.purpose = 'avatar' AND p.deleted_at IS NULL AND u.avatar_key = p.r2_key
      AND p.id IN (SELECT substr(target, 8) FROM reports WHERE target LIKE 'avatar:%'
                   AND target NOT IN (SELECT target FROM target_decisions))`,
  dmReports: `SELECT COUNT(*) AS n FROM (SELECT status FROM dm_reports ORDER BY id DESC LIMIT 300) WHERE status = 'open'`,
  takedowns: `SELECT COUNT(*) AS n FROM takedown_notices WHERE status IN ('pending', 'counter')`,
  errorReports: `SELECT COUNT(*) AS n FROM error_reports WHERE status = 'open'`,
  feedback: `SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'`,
  deletions: `SELECT COUNT(*) AS n FROM deletion_requests WHERE status = 'pending'`,
  artistPhotos: `SELECT COUNT(*) AS n FROM artist_photos WHERE status = 'pending'`,
  additions: `SELECT COUNT(*) AS n FROM (SELECT confirmed_at FROM catalog_additions ORDER BY id DESC LIMIT 300) WHERE confirmed_at IS NULL`,
} as const;

type Part = keyof typeof Q;

/** 每一項的細項（核對用）＋選單要的合計 */
export async function adminNavCounts(): Promise<{ counts: AdminCounts; detail: Record<Part, number> }> {
  const keys = Object.keys(Q) as Part[];
  const [rows, dups] = await Promise.all([env.DB!.batch(keys.map((k) => env.DB!.prepare(Q[k]))), detectDuplicatePairs()]);
  const detail = Object.fromEntries(keys.map((k, i) => [k, Number((rows[i].results?.[0] as { n?: number } | undefined)?.n ?? 0)])) as Record<Part, number>;
  return {
    detail,
    counts: {
      moderation: detail.pending + detail.reports + detail.appeals + detail.comments + detail.avatars,
      dmReports: detail.dmReports,
      takedowns: detail.takedowns,
      errorReports: detail.errorReports,
      additions: detail.additions,
      duplicates: dups.length,
      artistPhotos: detail.artistPhotos,
      deletions: detail.deletions,
      feedback: detail.feedback,
    },
  };
}
