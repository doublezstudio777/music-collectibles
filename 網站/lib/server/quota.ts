// 每個帳號每日瀏覽上限：辨識細節、大圖（2026-09-28 防盜版批次）。
//
// 不可以每個請求都寫 D1：計數先放在 Worker 記憶體（isolate），累積 FLUSH_EVERY 次才用一條
// UPSERT … RETURNING 把增量加進 D1 counters，同時拿回全域的最新總數（其他 isolate 加的也看得到）。
// 同一個 isolate 第一次遇到這個帳號今天的鍵時讀一次 D1 當起點。
// 誤差：每個 isolate 最多多放行 FLUSH_EVERY − 1 次；isolate 被回收時沒寫進去的會少算（最多 FLUSH_EVERY − 1）。
// 鍵：quota:{detail|photo}:{userId}:{YYYY-MM-DD}（UTC 日期），每天換新鍵，舊鍵留著給後台看，不影響計數。

import { env } from "cloudflare:workers";

export type QuotaKind = "detail" | "photo";
export const DEFAULT_QUOTA: Record<QuotaKind, number> = { detail: 100, photo: 300 };
export const QUOTA_SETTING: Record<QuotaKind, string> = { detail: "daily_detail_limit", photo: "daily_photo_limit" };
export const QUOTA_MESSAGE: Record<QuotaKind, string> = {
  detail: "今天看辨識細節的次數已達上限，明天再來",
  photo: "今天看大圖的次數已達上限，明天再來",
};
const FLUSH_EVERY = 10;
const MAX_KEYS = 20_000;

type E = { base: number; pending: number };
const mem = new Map<string, E>();

const keyOf = (kind: QuotaKind, userId: string) => `quota:${kind}:${userId}:${new Date().toISOString().slice(0, 10)}`;

/** 從 settings 讀上限；沒設或不合法用預設值 */
export async function quotaLimit(kind: QuotaKind): Promise<number> {
  const row = await env.DB!.prepare(`SELECT value FROM settings WHERE key = ?1`).bind(QUOTA_SETTING[kind]).first<{ value: string }>();
  const n = Number(row?.value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_QUOTA[kind];
}

/** 用掉一次；還有額度回 true，到上限回 false（不計入） */
export async function takeQuota(kind: QuotaKind, userId: string, limit: number): Promise<boolean> {
  const db = env.DB!;
  const key = keyOf(kind, userId);
  let e = mem.get(key);
  if (!e) {
    if (mem.size >= MAX_KEYS) mem.clear();
    const row = await db.prepare(`SELECT value FROM counters WHERE key = ?1`).bind(key).first<{ value: number }>();
    e = { base: row?.value ?? 0, pending: 0 };
    mem.set(key, e);
  }
  if (e.base + e.pending >= limit) return false;
  e.pending += 1;
  if (e.pending >= FLUSH_EVERY) await flush(key, e);
  return true;
}

async function flush(key: string, e: E) {
  const n = e.pending;
  e.pending = 0;
  try {
    const row = await env
      .DB!.prepare(
        `INSERT INTO counters (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value RETURNING value`,
      )
      .bind(key, n)
      .first<{ value: number }>();
    e.base = row?.value ?? e.base + n;
  } catch {
    e.pending += n;
  }
}

/** 驗收與後台用：這個 isolate 裡還沒寫進 D1 的量 */
export const pendingQuota = (kind: QuotaKind, userId: string) => mem.get(keyOf(kind, userId))?.pending ?? 0;
