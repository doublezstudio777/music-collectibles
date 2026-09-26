// 個人狀態：點讚、我有、想要、追蹤。讀寫都是「設定成某狀態」（冪等），App 重送不會出錯。

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { follows, holdings, likes } from "@/db/schema";

export type MyState = { liked: number[]; owned: string[]; wanted: string[]; follows: string[] };

export async function myState(userId: string): Promise<MyState> {
  const db = getDb();
  const [l, h, f] = await db.batch([
    db.select({ n: likes.shareNo }).from(likes).where(eq(likes.userId, userId)).orderBy(asc(likes.createdAt)),
    db
      .select({ kind: holdings.kind, key: holdings.targetKey })
      .from(holdings)
      .where(eq(holdings.userId, userId))
      .orderBy(asc(holdings.createdAt)),
    db.select({ slug: follows.artistSlug }).from(follows).where(eq(follows.userId, userId)).orderBy(asc(follows.createdAt)),
  ]);
  return {
    liked: l.map((x) => x.n),
    owned: h.filter((x) => x.kind === "owned").map((x) => x.key),
    wanted: h.filter((x) => x.kind === "wanted").map((x) => x.key),
    follows: f.map((x) => x.slug),
  };
}

/** 公開的我有／想要（個人頁） */
export async function publicHoldings(userId: string) {
  const s = await myState(userId);
  return { owned: s.owned, wanted: s.wanted };
}

// 內容（炫收藏、藝人、版本）2b 才進 D1，這輪只檢查識別碼格式
export const validShareNo = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9;
export const validSlug = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v);
export const validVersionKey = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 160 && /^[a-z0-9-]+\/\d+#[a-z0-9-]+$/.test(v);

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
