// 成交紀錄與歷史價格（2c）。成交時記一筆，改回出售中時作廢；行情由 lib/prices.ts 的 summarize 算。

import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { deals } from "@/db/schema";
import { summarize, type DealPoint, type PriceSummary } from "@/lib/prices";
import type { ShareRow } from "@/lib/server/content";

export async function recordDeal(s: ShareRow, o: { id: number; price: number; buyerId: string }, at: string) {
  const versionKey = s.seriesKey && s.itemId && s.versionId ? `${s.seriesKey}#${s.itemId}-${s.versionId}` : null;
  await getDb()
    .insert(deals)
    .values({ shareNo: s.no, offerId: o.id, versionKey, price: o.price, sellerId: s.authorId, buyerId: o.buyerId, soldAt: at });
}

export async function voidDeals(shareNo: number) {
  await getDb()
    .update(deals)
    .set({ voidedAt: new Date().toISOString() })
    .where(and(eq(deals.shareNo, shareNo), isNull(deals.voidedAt)));
}

/**
 * 一個系列所有版本的行情。skip＝被鎖的收藏（不算開價、出價區間）。
 * 成交只算：沒作廢、雙方目前都是認證帳號、那則收藏沒被刪或隱藏。
 */
export async function priceSummaries(seriesKey: string, skip: Set<number>): Promise<Map<string, PriceSummary>> {
  const db = env.DB!;
  const like = `${seriesKey}#%`;
  const [d, a, b] = await db.batch([
    db
      .prepare(
        `SELECT d.version_key AS k, d.price, d.sold_at AS soldAt, d.seller_id AS sellerId, d.buyer_id AS buyerId
         FROM deals d
         JOIN users s ON s.id = d.seller_id AND s.email_verified_at IS NOT NULL
         JOIN users b ON b.id = d.buyer_id AND b.email_verified_at IS NOT NULL
         JOIN shares sh ON sh.no = d.share_no AND sh.deleted_at IS NULL AND sh.hidden_at IS NULL
         WHERE d.voided_at IS NULL AND d.version_key LIKE ?1`,
      )
      .bind(like),
    db
      .prepare(
        `SELECT no, series_key || '#' || item_id || '-' || version_id AS k, price FROM shares
         WHERE series_key = ?1 AND version_id IS NOT NULL AND sale_state = 'sale' AND price IS NOT NULL
           AND deleted_at IS NULL AND hidden_at IS NULL`,
      )
      .bind(seriesKey),
    db
      .prepare(
        `SELECT sh.no, sh.series_key || '#' || sh.item_id || '-' || sh.version_id AS k, o.price FROM offers o
         JOIN shares sh ON sh.no = o.share_no
         WHERE sh.series_key = ?1 AND sh.version_id IS NOT NULL AND sh.sale_state IN ('offer', 'sale')
           AND sh.deleted_at IS NULL AND sh.hidden_at IS NULL AND o.status IN ('open', 'accepted')`,
      )
      .bind(seriesKey),
  ]);
  const byKey = new Map<string, DealPoint[]>();
  for (const r of d.results as (DealPoint & { k: string })[]) {
    const list = byKey.get(r.k) ?? [];
    list.push(r);
    byKey.set(r.k, list);
  }
  const collect = (rows: { no: number; k: string; price: number }[]) => {
    const m = new Map<string, number[]>();
    rows.filter((r) => !skip.has(r.no)).forEach((r) => m.set(r.k, [...(m.get(r.k) ?? []), r.price]));
    return m;
  };
  const asks = collect(a.results as { no: number; k: string; price: number }[]);
  const bids = collect(b.results as { no: number; k: string; price: number }[]);
  const out = new Map<string, PriceSummary>();
  for (const [k, list] of byKey) {
    const sum = summarize(list, asks.get(k) ?? [], bids.get(k) ?? []);
    if (sum) out.set(k, sum);
  }
  return out;
}
