// 炫收藏發布、出售狀態、出價、私訊。錢貨不經過平台：成交只是賣家把這則標成已售出。
//
// 權限一律在這裡判斷（不是畫面藏按鈕）：
// - 只有作者能改出售狀態、接受／拒絕、成交、改回出售中
// - 只有出價的人能撤回；作者不能對自己的收藏出價
// - 被鎖（檢舉達門檻、或品項／版本被鎖）時：不能改出售狀態、出價、我要買、接受、撤回、成交。
//   判斷跟單則頁同一個 lockFor（lib/server/content.ts 的 lockForShare）

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { items, messages, offers, series, shares, threadReads, threads, versions, photos } from "@/db/schema";
import { KINDS, priceText, relTime, type Kind, type SaleState } from "@/lib/data";
import { lockForShare, userNames, type ShareRow } from "@/lib/server/content";
import { contentKeyExists, parseContentKey } from "@/lib/server/me";
import { unattachedPhotos } from "@/lib/server/photos";
import { hit } from "@/lib/server/services";
import { fail, type User } from "@/lib/server/auth";
import { recordDeal, voidDeals } from "@/lib/server/prices";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 路由用：把 HttpError 轉成統一的錯誤 JSON */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message);
    throw e;
  }
}

const nowIso = () => new Date().toISOString();
export const MAX_PRICE = 10_000_000;
export const validPrice = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_PRICE;

export async function shareRow(no: number): Promise<ShareRow> {
  const [row] = await getDb()
    .select()
    .from(shares)
    .where(and(eq(shares.no, no), isNull(shares.deletedAt), isNull(shares.hiddenAt)));
  if (!row) throw new HttpError(404, "NOT_FOUND", "找不到這則收藏");
  return row;
}

async function assertNotLocked(s: ShareRow) {
  const lock = await lockForShare(s);
  if (lock) throw new HttpError(423, "LOCKED", `${lock.label}，交易暫停`);
}

const assertAuthor = (s: ShareRow, u: User) => {
  if (s.authorId !== u.id) throw new HttpError(403, "FORBIDDEN", "只有這則的作者可以這樣做");
};

/* ---------- 發布 ---------- */

const strList = (v: unknown, max: number, len: number) =>
  Array.isArray(v)
    ? Array.from(new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)))
        .slice(0, max)
        .map((x) => x.slice(0, len))
    : [];

export async function createShare(u: User, body: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const photoIds = strList(body.photoIds, 6, 40);
  const about = strList(body.about, 10, 40);
  const tags = strList(body.tags, 10, 30);
  const story = typeof body.story === "string" ? body.story.trim().slice(0, 2000) : "";
  const refPhoto = body.refPhoto === true;
  const sale = (body.sale ?? {}) as { state?: unknown; price?: unknown };
  const saleState: SaleState = sale.state === "offer" || sale.state === "sale" ? sale.state : "share";
  if (saleState === "sale" && !validPrice(sale.price)) errors.price = "填一個整數金額";

  const pics = await unattachedPhotos(u.id, photoIds, "share");
  if (pics.length === 0) errors.photo = "放一張照片";
  if (about.length === 0) errors.about = "至少點一位";

  // 系列＞品項＞版本（可以不選系列；選了系列就要選品項）
  const seriesKey = typeof body.seriesKey === "string" && body.seriesKey ? body.seriesKey : null;
  const itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : null;
  const versionId = typeof body.versionId === "string" && body.versionId ? body.versionId : null;
  let kind: Kind | null = null;
  let kindNote: string | null = null;
  let seriesTitle = "";
  let edition = "";
  if (seriesKey) {
    const k = parseContentKey(seriesKey);
    if (!k || k.itemId || !(await contentKeyExists(seriesKey, "series"))) errors.kind = "找不到這個系列";
    else if (!itemId || !(await contentKeyExists(`${seriesKey}#${itemId}`, "item"))) errors.kind = "點一個品項";
    else if (versionId && !(await contentKeyExists(`${seriesKey}#${itemId}-${versionId}`, "version"))) errors.kind = "找不到這個版本";
    else {
      const db = getDb();
      const [row] = await db
        .select({ title: series.title, kind: items.kind, edition: versions.edition })
        .from(series)
        .innerJoin(items, and(eq(items.seriesId, series.id), eq(items.itemId, itemId)))
        .leftJoin(versions, and(eq(versions.itemRef, items.id), eq(versions.versionId, versionId ?? "")))
        .where(and(eq(series.artistSlug, k.artist), eq(series.no, k.no)));
      kind = (row?.kind as Kind) ?? null;
      seriesTitle = row?.title ?? "";
      edition = versionId ? (row?.edition ?? "") : "";
    }
  } else {
    kind = (KINDS as readonly string[]).includes(String(body.kind)) ? (body.kind as Kind) : null;
    if (!kind) errors.kind = "點一個類型";
    kindNote = typeof body.kindNote === "string" ? body.kindNote.trim().slice(0, 30) || null : null;
    if (kind === "其他周邊" && !kindNote) errors.kind = "寫一下是什麼周邊";
  }
  if (Object.keys(errors).length || !kind) {
    throw new HttpError(400, "INVALID", Object.values(errors)[0] ?? "有欄位沒填好");
  }
  const day = nowIso().slice(0, 10);
  if (!(await hit(`share:${u.id}:${day}`, 30, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天發太多則了，明天再來");

  const what = seriesKey
    ? [seriesTitle, kind, edition].filter(Boolean).join(" ")
    : `${about.join("、")} ${kind === "其他周邊" ? kindNote : kind}`;
  const db = getDb();
  const [created] = await db
    .insert(shares)
    .values({
      authorId: u.id,
      what,
      kind,
      kindNote: kind === "其他周邊" ? kindNote : null,
      story,
      about: JSON.stringify(about),
      tags: JSON.stringify(tags),
      seriesKey,
      itemId: seriesKey ? itemId : null,
      versionId: seriesKey ? versionId : null,
      refPhoto: refPhoto ? 1 : 0,
      saleState,
      price: saleState === "sale" ? (sale.price as number) : null,
    })
    .returning({ no: shares.no });
  await db.batch(
    pics.map((p, i) =>
      db
        .update(photos)
        .set({ shareNo: created.no, sort: i })
        .where(and(eq(photos.id, p.id), isNull(photos.shareNo))),
    ) as never,
  );
  return created.no;
}

/* ---------- 對話與系統訊息 ---------- */

async function ensureThread(no: number, buyerId: string) {
  const db = getDb();
  await db.insert(threads).values({ shareNo: no, buyerId }).onConflictDoNothing();
  const [t] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.shareNo, no), eq(threads.buyerId, buyerId)));
  return t;
}

async function sys(threadId: number, text: string) {
  const db = getDb();
  await db.insert(messages).values({ threadId, fromId: null, text });
  await db.update(threads).set({ updatedAt: nowIso() }).where(eq(threads.id, threadId));
}

/** 對某則收藏的每一條對話插一行系統訊息 */
async function broadcast(no: number, text: (threadId: number) => string | null) {
  const list = await getDb().select().from(threads).where(eq(threads.shareNo, no));
  for (const t of list) {
    const line = text(t.id);
    if (line) await sys(t.id, line);
  }
}

/* ---------- 出售狀態 ---------- */

const stateWord: Record<SaleState, string> = {
  share: "這件不賣了",
  offer: "改為開放出價",
  sale: "改為定價出售",
  sold: "這件已售出",
};

export async function setSale(u: User, no: number, state: unknown, price: unknown) {
  const s = await shareRow(no);
  assertAuthor(s, u);
  if (s.saleState === "sold") throw new HttpError(409, "SOLD", "已售出，要先改回出售中");
  if (state !== "share" && state !== "offer" && state !== "sale") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (state === "sale" && !validPrice(price)) throw new HttpError(400, "INVALID", "填一個整數金額");
  await assertNotLocked(s);
  const nextPrice = state === "sale" ? (price as number) : null;
  if (state === s.saleState && nextPrice === (state === "sale" ? s.price : null)) return;
  await getDb()
    .update(shares)
    .set({ saleState: state, price: state === "sale" ? nextPrice : s.price, updatedAt: nowIso() })
    .where(eq(shares.no, no));
  const line =
    state === "sale" && s.saleState === "sale"
      ? `價格改為 ${priceText(nextPrice ?? 0)}`
      : state === "sale"
        ? `改為定價出售 ${priceText(nextPrice ?? 0)}`
        : stateWord[state];
  await broadcast(no, () => line);
}

/** 已售出改回出售中：原本有定價就回定價出售，否則開放出價；成交紀錄清掉 */
export async function reopen(u: User, no: number) {
  const s = await shareRow(no);
  assertAuthor(s, u);
  if (s.saleState !== "sold") throw new HttpError(409, "NOT_SOLD", "這則沒有售出");
  await assertNotLocked(s);
  await getDb()
    .update(shares)
    .set({ saleState: s.price ? "sale" : "offer", soldPrice: null, soldTo: null, soldAt: null, updatedAt: nowIso() })
    .where(eq(shares.no, no));
  // 原本成交的那筆不再算成交（紀錄留著，標撤回）
  await getDb()
    .update(offers)
    .set({ status: "withdrawn", updatedAt: nowIso() })
    .where(and(eq(offers.shareNo, no), eq(offers.status, "sold")));
  // 歷史價格：這筆成交不算了（紀錄留著，標作廢）
  await voidDeals(no);
  await broadcast(no, () => "賣家改回出售中");
}

/* ---------- 出價 ---------- */

/** 買家出價（開放出價）或我要買（定價出售）。同一買家再出價＝取代舊的（舊的標撤回） */
export async function placeOffer(u: User, no: number, kind: unknown, price: unknown) {
  const s = await shareRow(no);
  if (s.authorId === u.id) throw new HttpError(403, "FORBIDDEN", "不能對自己的收藏出價");
  if (kind !== "offer" && kind !== "buy") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (kind === "offer" && s.saleState !== "offer") throw new HttpError(409, "NOT_OPEN", "這則現在不開放出價");
  if (kind === "buy" && s.saleState !== "sale") throw new HttpError(409, "NOT_OPEN", "這則現在沒有定價出售");
  const p = kind === "buy" ? s.price : price;
  if (!validPrice(p)) throw new HttpError(400, "INVALID", "填一個整數金額");
  await assertNotLocked(s);
  if (!(await hit(`offer:${u.id}`, 60, 3600))) throw new HttpError(429, "RATE_LIMITED", "出價太頻繁，等一下再試");
  const db = getDb();
  const t = await ensureThread(no, u.id);
  const live = await db
    .select()
    .from(offers)
    .where(and(eq(offers.shareNo, no), eq(offers.buyerId, u.id), inArray(offers.status, ["open", "accepted"])));
  if (kind === "buy" && live.some((o) => o.kind === "buy")) return t.id;
  if (live.length) {
    await db
      .update(offers)
      .set({ status: "withdrawn", updatedAt: nowIso() })
      .where(inArray(offers.id, live.map((o) => o.id)));
  }
  const [o] = await db.insert(offers).values({ shareNo: no, buyerId: u.id, threadId: t.id, kind, price: p }).returning();
  await db.insert(messages).values({ threadId: t.id, fromId: u.id, offerId: o.id });
  await db.update(threads).set({ updatedAt: nowIso() }).where(eq(threads.id, t.id));
  return t.id;
}

async function offerWithShare(id: number) {
  const [o] = await getDb().select().from(offers).where(eq(offers.id, id));
  if (!o) throw new HttpError(404, "NOT_FOUND", "找不到這筆出價");
  return { o, s: await shareRow(o.shareNo) };
}

export async function respondOffer(u: User, id: number, answer: unknown) {
  if (answer !== "accepted" && answer !== "rejected") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const { o, s } = await offerWithShare(id);
  assertAuthor(s, u);
  if (s.saleState === "sold") throw new HttpError(409, "SOLD", "已售出");
  if (o.status !== "open") throw new HttpError(409, "NOT_OPEN", "這筆出價已經處理過");
  await assertNotLocked(s);
  await getDb().update(offers).set({ status: answer, updatedAt: nowIso() }).where(eq(offers.id, id));
  await sys(o.threadId, `賣家${answer === "accepted" ? "接受" : "拒絕"}了 ${priceText(o.price)}`);
}

export async function withdrawOffer(u: User, id: number) {
  const { o, s } = await offerWithShare(id);
  if (o.buyerId !== u.id) throw new HttpError(403, "FORBIDDEN", "只有出價的人可以撤回");
  if (o.status !== "open") throw new HttpError(409, "NOT_OPEN", "這筆出價已經處理過");
  await assertNotLocked(s);
  await getDb().update(offers).set({ status: "withdrawn", updatedAt: nowIso() }).where(eq(offers.id, id));
  await sys(o.threadId, `買家撤回了 ${priceText(o.price)}`);
}

/** 成交給接受過的那一筆：這則標已售出，成交那條插「已成交」，其他條插「這件已售出」 */
export async function closeDeal(u: User, no: number, offerId: unknown) {
  if (typeof offerId !== "number") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const { o, s } = await offerWithShare(offerId);
  if (s.no !== no) throw new HttpError(400, "BAD_REQUEST", "這筆出價不是這則的");
  assertAuthor(s, u);
  if (s.saleState === "sold") throw new HttpError(409, "SOLD", "已售出");
  if (o.status !== "accepted") throw new HttpError(409, "NOT_ACCEPTED", "要先接受這筆出價");
  await assertNotLocked(s);
  const db = getDb();
  const at = nowIso();
  await db.update(offers).set({ status: "sold", updatedAt: at }).where(eq(offers.id, o.id));
  await db
    .update(shares)
    .set({ saleState: "sold", soldPrice: o.price, soldTo: o.buyerId, soldAt: at, updatedAt: at })
    .where(eq(shares.no, no));
  await recordDeal(s, o, at);
  await broadcast(no, (tid) => (tid === o.threadId ? `已成交 ${priceText(o.price)}` : "這件已售出"));
}

/* ---------- 公開出價列表（單則頁） ---------- */

export type PublicOffer = {
  id: number;
  threadId: number;
  buyer: { handle: string; name: string };
  kind: "offer" | "buy";
  price: number;
  status: "open" | "accepted" | "rejected" | "withdrawn" | "sold";
  time: string;
};

/** 同一買家只留最新一筆 */
export async function publicOffers(no: number): Promise<PublicOffer[]> {
  const rows = await getDb().select().from(offers).where(eq(offers.shareNo, no)).orderBy(desc(offers.id));
  const latest = new Map<string, (typeof rows)[number]>();
  rows.forEach((r) => {
    if (!latest.has(r.buyerId)) latest.set(r.buyerId, r);
  });
  const names = await userNames([...latest.keys()]);
  const now = Date.now();
  return [...latest.values()]
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      threadId: r.threadId,
      buyer: names.get(r.buyerId) ?? { handle: "", name: "（已刪除）" },
      kind: r.kind as PublicOffer["kind"],
      price: r.price,
      status: r.status as PublicOffer["status"],
      time: relTime(r.createdAt, now),
    }));
}

/* ---------- 私訊 ---------- */

/** 問賣家：開一條對話但不出價 */
export async function openThread(u: User, no: number) {
  const s = await shareRow(no);
  if (s.authorId === u.id) throw new HttpError(403, "FORBIDDEN", "這是你自己的收藏");
  return (await ensureThread(no, u.id)).id;
}

async function threadFor(u: User, id: number) {
  const db = getDb();
  const [row] = await db
    .select({ t: threads, authorId: shares.authorId })
    .from(threads)
    .innerJoin(shares, eq(shares.no, threads.shareNo))
    .where(eq(threads.id, id));
  if (!row || (row.t.buyerId !== u.id && row.authorId !== u.id)) throw new HttpError(404, "NOT_FOUND", "找不到這段對話");
  return { ...row.t, sellerId: row.authorId };
}

export async function sendText(u: User, id: number, text: unknown) {
  const t = await threadFor(u, id);
  const body = typeof text === "string" ? text.trim().slice(0, 1000) : "";
  if (!body) throw new HttpError(400, "INVALID", "寫點什麼再送出");
  if (!(await hit(`msg:${u.id}`, 120, 3600))) throw new HttpError(429, "RATE_LIMITED", "訊息太頻繁，等一下再試");
  const db = getDb();
  await db.insert(messages).values({ threadId: t.id, fromId: u.id, text: body });
  await db.update(threads).set({ updatedAt: nowIso() }).where(eq(threads.id, t.id));
}

async function markRead(userId: string, threadId: number, lastId: number) {
  await getDb()
    .insert(threadReads)
    .values({ threadId, userId, lastMessageId: lastId })
    .onConflictDoUpdate({ target: [threadReads.threadId, threadReads.userId], set: { lastMessageId: lastId } });
}

export type ThreadMessage = {
  id: number;
  from: string | null;
  text?: string;
  offer?: { id: number; kind: "offer" | "buy"; price: number; status: PublicOffer["status"] };
  time: string;
};

/** 我的對話列表（買家或賣家）＋每條最後一則與未讀 */
export async function myThreads(u: User) {
  const db = getDb();
  const list = await db
    .select({ t: threads, authorId: shares.authorId, what: shares.what })
    .from(threads)
    .innerJoin(shares, eq(shares.no, threads.shareNo))
    .where(or(eq(threads.buyerId, u.id), eq(shares.authorId, u.id)))
    .orderBy(desc(threads.updatedAt));
  if (!list.length) return [];
  const ids = list.map((x) => x.t.id);
  const [msgs, reads] = await db.batch([
    db.select().from(messages).where(inArray(messages.threadId, ids)).orderBy(asc(messages.id)),
    db.select().from(threadReads).where(and(eq(threadReads.userId, u.id), inArray(threadReads.threadId, ids))),
  ]);
  const offerIds = msgs.map((m) => m.offerId).filter((x): x is number => x !== null);
  const offerRows = offerIds.length ? await db.select().from(offers).where(inArray(offers.id, offerIds)) : [];
  const names = await userNames([...list.map((x) => x.t.buyerId), ...list.map((x) => x.authorId)]);
  const nos = Array.from(new Set(list.map((x) => x.t.shareNo)));
  const pics = await db
    .select({ n: photos.shareNo, key: photos.thumbKey, sort: photos.sort })
    .from(photos)
    .where(and(inArray(photos.shareNo, nos), isNull(photos.deletedAt)))
    .orderBy(asc(photos.sort));
  const now = Date.now();
  return list
    .map(({ t, authorId, what }) => {
      const mine = msgs.filter((m) => m.threadId === t.id);
      const last = [...mine].reverse().find((m) => m.fromId !== null);
      const read = reads.find((r) => r.threadId === t.id)?.lastMessageId ?? 0;
      const unread = mine.some((m) => m.id > read && m.fromId !== u.id);
      const iAmSeller = authorId === u.id;
      const other = names.get(iAmSeller ? t.buyerId : authorId) ?? { handle: "", name: "（已刪除）" };
      const lo = last?.offerId ? offerRows.find((o) => o.id === last.offerId) : undefined;
      return {
        id: t.id,
        shareNo: t.shareNo,
        what,
        thumb: pics.find((p) => p.n === t.shareNo)?.key ? `/img/${pics.find((p) => p.n === t.shareNo)?.key}` : null,
        iAmSeller,
        other,
        lastFrom: last?.fromId ? (names.get(last.fromId)?.name ?? "") : "",
        preview: lo ? `${lo.kind === "buy" ? "我要買" : "出價"} ${priceText(lo.price)}` : (last?.text ?? ""),
        time: last ? relTime(last.createdAt, now) : "",
        unread,
        empty: mine.length === 0,
      };
    })
    .filter((x) => !x.empty)
    .sort((a, b) => Number(b.unread) - Number(a.unread));
}

export async function threadDetail(u: User, id: number) {
  const t = await threadFor(u, id);
  const db = getDb();
  const msgs = await db.select().from(messages).where(eq(messages.threadId, id)).orderBy(asc(messages.id));
  const offerIds = msgs.map((m) => m.offerId).filter((x): x is number => x !== null);
  const offerRows = offerIds.length ? await db.select().from(offers).where(inArray(offers.id, offerIds)) : [];
  const names = await userNames([t.buyerId, t.sellerId]);
  const now = Date.now();
  if (msgs.length) await markRead(u.id, id, msgs[msgs.length - 1].id);
  const out: ThreadMessage[] = msgs.map((m) => {
    const o = m.offerId ? offerRows.find((x) => x.id === m.offerId) : undefined;
    return {
      id: m.id,
      from: m.fromId ? (names.get(m.fromId)?.handle ?? "") : null,
      ...(m.text ? { text: m.text } : {}),
      ...(o ? { offer: { id: o.id, kind: o.kind as "offer" | "buy", price: o.price, status: o.status as PublicOffer["status"] } } : {}),
      time: relTime(m.createdAt, now),
    };
  });
  return {
    id: t.id,
    shareNo: t.shareNo,
    iAmSeller: t.sellerId === u.id,
    buyer: names.get(t.buyerId) ?? { handle: "", name: "（已刪除）" },
    seller: names.get(t.sellerId) ?? { handle: "", name: "（已刪除）" },
    messages: out,
  };
}
