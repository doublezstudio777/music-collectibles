import { json, requireAdmin } from "@/lib/server/auth";
import { cleanupOldRecords, RETENTION_DAYS } from "@/lib/server/cleanup";

/**
 * 手動跑一次資料保存期限清理（正常由 Cron Trigger 每天自動跑，這支給管理員手動觸發、也給本機驗收用）。
 * 清 user_activity／user_geo／rate_limits 超過 {@link RETENTION_DAYS} 天的列，寫一筆 admin_log。
 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const result = await cleanupOldRecords();
  return json({ ok: true, retentionDays: RETENTION_DAYS, ...result });
}
