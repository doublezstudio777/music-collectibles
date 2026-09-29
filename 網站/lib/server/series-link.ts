// 炫收藏掛系列（2026-09-28 周邊選擇流程）：
// - 每位藝人的「周邊與其他」（series.kind = misc）第一次有人用到才建，不替全部藝人預先建
// - 選了系列但系列裡還沒有這種品項（例：演唱會還沒有毛巾）→ 自動建品項，版本等人補
// - 會員新增的系列還在審核 → 收藏先掛「不確定」，記 shares.pending_series_id；核准時改掛過去
// 系列流水號規則跟 moderation.ts 新增系列同一套：待審、被退回、永久刪除過的號都不重用。

import { and, asc, eq, isNull, max } from "drizzle-orm";
import { getDb } from "@/db";
import { artists, counters, items, series, shares, versions } from "@/db/schema";
import { composeWhat, KINDS, MISC_SERIES_TITLE, type Kind } from "@/lib/data";
import { creditCreate } from "@/lib/server/scores";

export const ITEM_SLUG: Record<Kind, string> = {
  CD: "cd",
  黑膠: "vinyl",
  卡帶: "cassette",
  "藍光／DVD": "bluray",
  毛巾: "towel",
  "T 恤": "tshirt",
  海報: "poster",
  場刊: "program",
  其他周邊: "goods",
};

/** 這位藝人下一個系列流水號 */
export async function nextSeriesNo(artistSlug: string) {
  const db = getDb();
  const [m] = await db.select({ n: max(series.no) }).from(series).where(eq(series.artistSlug, artistSlug));
  const [c] = await db.select({ v: counters.value }).from(counters).where(eq(counters.key, `series_no:${artistSlug}`));
  return Math.max(m?.n ?? 0, c?.v ?? 0) + 1;
}

async function findMisc(artistSlug: string) {
  const [w] = await getDb()
    .select({ id: series.id, no: series.no, title: series.title, status: series.status, deletedAt: series.deletedAt, hiddenAt: series.hiddenAt })
    .from(series)
    .where(and(eq(series.artistSlug, artistSlug), eq(series.kind, "misc")));
  return w;
}

/**
 * 「周邊與其他」：有就回傳，沒有就建（直接生效，不進審核，這是站方固定分類不是會員新增的內容）。
 * 被管理員隱藏或刪除的不重建，回 null（呼叫端當作找不到）。
 */
export async function ensureMiscSeries(artistSlug: string, userId: string): Promise<{ id: number; key: string; title: string } | null> {
  const db = getDb();
  const [a] = await db
    .select({ slug: artists.slug })
    .from(artists)
    .where(and(eq(artists.slug, artistSlug), eq(artists.status, "approved"), isNull(artists.deletedAt)));
  if (!a) return null;
  let w = await findMisc(artistSlug);
  if (!w) {
    // 兩個請求同時進來：唯一索引 series_misc_uq（或流水號撞號）讓其中一個什麼都不做，再查一次就拿到同一個
    await db
      .insert(series)
      .values({
        artistSlug,
        no: await nextSeriesNo(artistSlug),
        title: MISC_SERIES_TITLE,
        name: MISC_SERIES_TITLE,
        seriesType: MISC_SERIES_TITLE,
        kind: "misc",
        year: "",
        credits: JSON.stringify([artistSlug]),
        body: "[]",
        status: "approved",
        createdBy: userId,
      })
      .onConflictDoNothing();
    w = await findMisc(artistSlug);
  }
  if (!w || w.status !== "approved" || w.deletedAt || w.hiddenAt) return null;
  return { id: w.id, key: `${artistSlug}/${w.no}`, title: w.title };
}

/**
 * 系列裡某種品項的 item_id：已有（approved、沒刪沒藏）就用第一個；沒有就建一個直接生效的品項（沒有版本）。
 * 自動建的品項跟會員送出的新增一樣可以被檢舉「官方沒出過這個品項」。
 * 新增當下 +15 入帳（2026-09-29，跟藝人／系列／版本一致）：來源鍵跟每日彙總補事件同一把（item:{id}），
 * 兩個請求同時搶建同一個品項時，只有真的插進去那個會拿到分數；沒插進去（撞唯一索引）的不重複給分。
 */
export async function ensureItem(seriesId: number, kind: Kind, userId: string): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ itemId: items.itemId, kind: items.kind, status: items.status, deletedAt: items.deletedAt, hiddenAt: items.hiddenAt })
    .from(items)
    .where(eq(items.seriesId, seriesId))
    .orderBy(asc(items.sort), asc(items.id));
  const hit = existing.find((x) => x.kind === kind && x.status === "approved" && !x.deletedAt && !x.hiddenAt);
  if (hit) return hit.itemId;
  const base = ITEM_SLUG[kind];
  let itemId = base;
  for (let i = 2; existing.some((x) => x.itemId === itemId); i++) itemId = `${base}${i}`;
  const inserted = await db
    .insert(items)
    .values({ seriesId, itemId, kind, sort: existing.length, status: "approved", createdBy: userId })
    .onConflictDoNothing()
    .returning({ id: items.id });
  if (inserted.length) await creditCreate(userId, "item", inserted[0].id);
  return itemId;
}

/**
 * 會員新增的系列核准了：等這個系列的收藏改掛過去（品項照收藏的類型找或建，版本「不確定」），標題重組。
 * 回傳改掛了幾則。
 */
export async function moveWaitingShares(seriesId: number, adminId: string) {
  const db = getDb();
  const [w] = await db.select().from(series).where(eq(series.id, seriesId));
  if (!w || w.status !== "approved") return 0;
  const waiting = await db
    .select({ no: shares.no, kind: shares.kind, kindNote: shares.kindNote })
    .from(shares)
    .where(and(eq(shares.pendingSeriesId, seriesId), isNull(shares.deletedAt)));
  const key = `${w.artistSlug}/${w.no}`;
  for (const s of waiting) {
    const kind = (KINDS as readonly string[]).includes(s.kind) ? (s.kind as Kind) : "其他周邊";
    const itemId = await ensureItem(w.id, kind, adminId);
    const what = composeWhat({ series: w.title, item: kind === "其他周邊" ? (s.kindNote ?? kind) : kind, version: "" });
    await db
      .update(shares)
      .set({ seriesKey: key, itemId, versionId: null, pendingSeriesId: null, what, updatedAt: new Date().toISOString() })
      .where(and(eq(shares.no, s.no), eq(shares.pendingSeriesId, seriesId)));
  }
  return waiting.length;
}

/** 會員新增的系列被退回：等它的收藏維持「不確定」，只清掉等待標記 */
export async function releaseWaitingShares(seriesId: number) {
  await getDb().update(shares).set({ pendingSeriesId: null }).where(eq(shares.pendingSeriesId, seriesId));
}

/** 表單送來的待審系列 id：要是這位會員自己新增、還在待審的，才准掛等待 */
export async function ownPendingSeries(userId: string, raw: unknown) {
  const id = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  const [w] = await getDb()
    .select({ id: series.id, title: series.title, createdBy: series.createdBy, status: series.status })
    .from(series)
    .where(and(eq(series.id, id), isNull(series.deletedAt)));
  return w && w.status === "pending" && w.createdBy === userId ? { id: w.id, title: w.title } : null;
}

/** 版本名稱（驗證 versionId 用） */
export async function versionEdition(seriesId: number, itemId: string, versionId: string) {
  const [row] = await getDb()
    .select({ edition: versions.edition, status: versions.status, deletedAt: versions.deletedAt, hiddenAt: versions.hiddenAt })
    .from(versions)
    .innerJoin(items, eq(items.id, versions.itemRef))
    .where(and(eq(items.seriesId, seriesId), eq(items.itemId, itemId), eq(versions.versionId, versionId)));
  return row && row.status === "approved" && !row.deletedAt && !row.hiddenAt ? row.edition : null;
}

/** 編輯表單用：這則在等哪個待審系列 */
export async function pendingSeriesOf(shareNo: number) {
  const [r] = await getDb()
    .select({ id: series.id, title: series.title, status: series.status })
    .from(shares)
    .innerJoin(series, eq(series.id, shares.pendingSeriesId))
    .where(eq(shares.no, shareNo));
  return r && r.status === "pending" ? { id: r.id, title: r.title } : null;
}
