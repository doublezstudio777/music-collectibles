// 個人狀態：點讚、我有、想要、追蹤。讀寫都是「設定成某狀態」（冪等），App 重送不會出錯。

import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appeals,
  artistDismissals,
  artists,
  follows,
  holdings,
  items,
  likes,
  messages,
  reports,
  series,
  shares,
  threadReads,
  threads,
  versions,
} from "@/db/schema";

export type MyState = {
  liked: number[];
  owned: string[];
  wanted: string[];
  follows: string[];
  /** 自己檢舉過的對象（每個對象一次） */
  reported: string[];
  /** 自己送過的申訴 */
  appeals: { target: string; status: string }[];
  /** 有未讀訊息的對話數 */
  unread: number;
  /** 首頁熱門藝人按過「不感興趣」的 */
  dismissed: string[];
};

export async function myState(userId: string): Promise<MyState> {
  const db = getDb();
  const [l, h, f, d] = await db.batch([
    db.select({ n: likes.shareNo }).from(likes).where(eq(likes.userId, userId)).orderBy(asc(likes.createdAt)),
    db
      .select({ kind: holdings.kind, key: holdings.targetKey })
      .from(holdings)
      .where(eq(holdings.userId, userId))
      .orderBy(asc(holdings.createdAt)),
    db.select({ slug: follows.artistSlug }).from(follows).where(eq(follows.userId, userId)).orderBy(asc(follows.createdAt)),
    db.select({ slug: artistDismissals.artistSlug }).from(artistDismissals).where(eq(artistDismissals.userId, userId)),
  ]);
  return {
    liked: l.map((x) => x.n),
    owned: h.filter((x) => x.kind === "owned").map((x) => x.key),
    wanted: h.filter((x) => x.kind === "wanted").map((x) => x.key),
    follows: f.map((x) => x.slug),
    dismissed: d.map((x) => x.slug),
    ...(await tradeState(userId)),
  };
}

/** 檢舉、申訴、未讀 */
async function tradeState(userId: string) {
  const db = getDb();
  const [r, a, u] = await db.batch([
    db.select({ t: reports.target }).from(reports).where(eq(reports.reporterId, userId)),
    db.select({ target: appeals.target, status: appeals.status }).from(appeals).where(eq(appeals.byId, userId)),
    // 我參與的對話（我是買家，或我是那則的作者）裡，別人發的、比我讀到的新的訊息
    db
      .select({ n: sql<number>`count(distinct ${threads.id})` })
      .from(threads)
      .innerJoin(shares, eq(shares.no, threads.shareNo))
      .innerJoin(messages, eq(messages.threadId, threads.id))
      .leftJoin(threadReads, and(eq(threadReads.threadId, threads.id), eq(threadReads.userId, userId)))
      .where(
        and(
          or(eq(threads.buyerId, userId), eq(shares.authorId, userId)),
          or(isNull(messages.fromId), ne(messages.fromId, userId)),
          gt(messages.id, sql`coalesce(${threadReads.lastMessageId}, 0)`),
        ),
      ),
  ]);
  return { reported: r.map((x) => x.t), appeals: a, unread: Number(u[0]?.n ?? 0) };
}

/** 公開的我有／想要（個人頁） */
export async function publicHoldings(userId: string) {
  const s = await myState(userId);
  return { owned: s.owned, wanted: s.wanted };
}

// 識別碼先檢查格式，再查存不存在（2b 起內容在 D1）
export const validShareNo = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9;
export const validSlug = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v);
export const validVersionKey = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 160 && /^[a-z0-9-]+\/\d+#[a-z0-9-]+$/.test(v);

/* ---------- 存在性檢查（點讚、我有、想要、追蹤、檢舉共用） ---------- */

export async function shareExists(no: number) {
  const [r] = await getDb()
    .select({ no: shares.no })
    .from(shares)
    .where(and(eq(shares.no, no), isNull(shares.deletedAt), isNull(shares.hiddenAt)));
  return Boolean(r);
}

export async function artistExists(slug: string) {
  const [r] = await getDb()
    .select({ slug: artists.slug })
    .from(artists)
    .where(and(eq(artists.slug, slug), eq(artists.status, "approved"), isNull(artists.deletedAt), isNull(artists.hiddenAt)));
  return Boolean(r);
}

/** 解析 `{藝人}/{流水號}#{品項}` 或 `...#{品項}-{版本}` */
export function parseContentKey(key: string) {
  const m = key.match(/^([a-z0-9-]+)\/(\d+)(?:#([a-z0-9]+)(?:-([a-z0-9]+))?)?$/);
  if (!m) return null;
  return { artist: m[1], no: Number(m[2]), itemId: m[3], versionId: m[4] };
}

/** 系列／品項／版本存不存在（只算已核准、沒刪除的） */
export async function contentKeyExists(key: string, level: "series" | "item" | "version") {
  const k = parseContentKey(key);
  if (!k) return false;
  if (level !== "series" && !k.itemId) return false;
  if (level === "version" && !k.versionId) return false;
  const db = getDb();
  const [row] = await db
    .select({ s: series.id, i: items.id, v: versions.id })
    .from(series)
    .leftJoin(items, and(eq(items.seriesId, series.id), eq(items.itemId, k.itemId ?? ""), eq(items.status, "approved"), isNull(items.deletedAt), isNull(items.hiddenAt)))
    .leftJoin(
      versions,
      and(eq(versions.itemRef, items.id), eq(versions.versionId, k.versionId ?? ""), eq(versions.status, "approved"), isNull(versions.deletedAt), isNull(versions.hiddenAt)),
    )
    .where(and(eq(series.artistSlug, k.artist), eq(series.no, k.no), eq(series.status, "approved"), isNull(series.deletedAt), isNull(series.hiddenAt)));
  if (!row) return false;
  if (level === "series") return true;
  if (level === "item") return row.i !== null;
  return row.v !== null;
}

export async function setLike(userId: string, shareNo: number, on: boolean) {
  const db = getDb();
  if (on) await db.insert(likes).values({ userId, shareNo }).onConflictDoNothing();
  else await db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.shareNo, shareNo)));
}

export async function setHolding(userId: string, kind: "owned" | "wanted", targetKey: string, on: boolean) {
  const db = getDb();
  if (on) await db.insert(holdings).values({ userId, kind, targetKey }).onConflictDoNothing();
  else
    await db
      .delete(holdings)
      .where(and(eq(holdings.userId, userId), eq(holdings.kind, kind), eq(holdings.targetKey, targetKey)));
}

export async function setFollow(userId: string, artistSlug: string, on: boolean) {
  const db = getDb();
  if (on) await db.insert(follows).values({ userId, artistSlug }).onConflictDoNothing();
  else await db.delete(follows).where(and(eq(follows.userId, userId), eq(follows.artistSlug, artistSlug)));
}

export async function clearFollows(userId: string) {
  await getDb().delete(follows).where(eq(follows.userId, userId));
}

export async function setDismiss(userId: string, artistSlug: string, on: boolean) {
  const db = getDb();
  if (on) await db.insert(artistDismissals).values({ userId, artistSlug }).onConflictDoNothing();
  else await db.delete(artistDismissals).where(and(eq(artistDismissals.userId, userId), eq(artistDismissals.artistSlug, artistSlug)));
}
