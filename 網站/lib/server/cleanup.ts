// 資料保存期限（上線後雜項，2026-09-28）：國家與活動紀錄、限流計數的持久化資料超過 90 天就清掉。
// 由 Worker 的 Cron Trigger 每天呼叫一次（worker.ts 的 scheduled；wrangler.production.jsonc 的 triggers.crons）。
// Cron Trigger 在免費方案可用（同一個 Worker 最多 5 條），呼叫本身跟一般請求共用同一份 CPU／請求配額，
// 一天一次的清理不會顯著吃掉額度。
//
// 清四類：
// - user_activity：每人每天每國一列，長期會一直長大，是主要的清理對象（day 是 YYYY-MM-DD，字串比較即可）
// - user_geo：只在使用者 90 天內都沒有登入（last_login_at 早於門檻）才清掉那一列；沒登入過（last_login_at
//   is null，剛註冊還沒登入）不動，因為沒有時間可以判斷「超過 90 天」
// - rate_limits：固定視窗計數，resetAt 早於門檻表示這個視窗早就結束、之後也沒再被打中，清掉
// - counters 的瀏覽次數（quota:{detail|photo}:{userId}:{YYYY-MM-DD}，2026-10-01 法務修正 M3）：日期早於門檻的清掉
//
// 操作紀錄寫進 admin_log（adminId="system"，跟 setPaused 的 webhook 同一個慣例），後台看得到。

import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { adminLog } from "@/db/schema";

export const RETENTION_DAYS = 90;

const cutoffDay = (now = new Date()) => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - RETENTION_DAYS);
  return d.toISOString().slice(0, 10);
};
const cutoffIso = (now = new Date()) => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - RETENTION_DAYS);
  return d.toISOString();
};

export type CleanupResult = { userActivity: number; userGeo: number; rateLimits: number; viewQuota: number };

/** 跑一次清理，回傳各表刪了幾列；同時寫一筆 admin_log（action="清理過期紀錄"） */
export async function cleanupOldRecords(now = new Date()): Promise<CleanupResult> {
  const db = env.DB!;
  const day = cutoffDay(now);
  const iso = cutoffIso(now);
  const [a, g, r, q] = await db.batch([
    db.prepare(`DELETE FROM user_activity WHERE day < ?1`).bind(day),
    db.prepare(`DELETE FROM user_geo WHERE last_login_at IS NOT NULL AND last_login_at < ?1`).bind(iso),
    db.prepare(`DELETE FROM rate_limits WHERE reset_at < ?1`).bind(iso),
    db.prepare(`DELETE FROM counters WHERE key LIKE 'quota:%' AND substr(key, -10) < ?1`).bind(day),
  ]);
  const result: CleanupResult = {
    userActivity: a.meta.changes ?? 0,
    userGeo: g.meta.changes ?? 0,
    rateLimits: r.meta.changes ?? 0,
    viewQuota: q.meta.changes ?? 0,
  };
  await getDb()
    .insert(adminLog)
    .values({ adminId: "system", action: "清理過期紀錄", target: "retention", detail: JSON.stringify({ retentionDays: RETENTION_DAYS, cutoff: day, ...result }) });
  return result;
}
