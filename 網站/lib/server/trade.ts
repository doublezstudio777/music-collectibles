// 炫收藏發布、出售狀態、出價、私訊。錢貨不經過平台：成交只是賣家把這則標成已售出。
//
// 權限一律在這裡判斷（不是畫面藏按鈕）：
// - 只有作者能改出售狀態、接受／拒絕、成交、改回出售中
// - 只有出價的人能撤回；作者不能對自己的收藏出價
// - 被鎖（檢舉達門檻、或品項／版本被鎖）時：不能改出售狀態、出價、我要買、接受、撤回、成交。
//   判斷跟單則頁同一個 lockFor（lib/server/content.ts 的 lockForShare）
//   2026-10-02 總檢 S9：鎖定中仍放行「賣家改回純分享」與「買家撤回出價」，這兩個都是降低風險的動作
// - 2026-10-02 總檢 M3：對方帳號停權或刪除後不能再出價、問賣家、傳訊息（assertActive）；
//   停權與刪帳當下 freezeUserTrade 把他名下出售中的收藏改純分享、未處理的出價撤回並在對話裡通知
// - 2026-10-02 總檢 S3：改回純分享時未處理的出價一併作廢；接受、成交要求這則仍在出售中
// - 2026-10-02 總檢 M1：作者可以刪除自己的收藏（deleteShare，軟刪除）

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, items, messages, offers, series, shares, threadReads, threads, photos, users } from "@/db/schema";
import { composeWhat, KINDS, priceText, relTime, type Kind, type SaleState } from "@/lib/data";
import { lockForShare, userNames, type ShareRow } from "@/lib/server/content";
import { parseContentKey } from "@/lib/server/me";
import { ensureItem, ensureMiscSeries, ownPendingSeries, versionEdition } from "@/lib/server/series-link";
import { dropOgImage, MAX_SHARE_PHOTOS, removePhotoFiles, unattachedPhotos } from "@/lib/server/photos";
import { hit, taiwanDay } from "@/lib/server/services";
import { fail, isAdmin, type User } from "@/lib/server/auth";
import { recordDeal, voidDeals } from "@/lib/server/prices";
import { regionNames, TRADE_ONLY_MESSAGE } from "@/lib/server/geo";
import { assertVerified, beforeSend, blockState, assertNotBlocked, reportedThreads, reportThread } from "@/lib/server/dm";
import { userBadges } from "@/lib/server/scores";

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
/** 每人每天最多發幾則（一般收藏與合集合計；一次發多張也是一張算一則） */
export const SHARE_DAILY = 30;
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

/** 全家福合集（2026-10-01）純展示：不能改出售狀態、出價、定價 */
export const assertNotCollection = (s: Pick<ShareRow, "postType">) => {
  if (s.postType === "collection") throw new HttpError(409, "COLLECTION", "合集只能分享，不能出價或定價");
};

const assertAuthor = (s: ShareRow, u: User) => {
  if (s.authorId !== u.id) throw new HttpError(403, "FORBIDDEN", "只有這則的作者可以這樣做");
};

/** 對方帳號要還在用（停權、刪除都不行）：出價、問賣家、傳訊息前都查（2026-10-02 總檢 M3） */
export async function assertActive(userId: string, message = "對方帳號已停用，無法再進行") {
  const [u] = userId ? await getDb().select({ status: users.status }).from(users).where(eq(users.id, userId)) : [];
  if (!u || u.status !== "active") throw new HttpError(409, "USER_INACTIVE", message);
}

/* ---------- 發布 ---------- */

const strList = (v: unknown, max: number, len: number) =>
  Array.isArray(v)
    ? Array.from(new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)))
        .slice(0, max)
        .map((x) => x.slice(0, len))
    : [];

/**
 * 內容欄位（發布與編輯共用）：跟誰有關、品項＞屬於哪裡（系列）＞版本、想說的話、標籤，連同組好的標題。
 * 2026-09-28 周邊選擇流程：先選品項（kind 必填），再選屬於哪裡：
 * - seriesKey＝「{藝人}/{流水號}」既有系列；或「misc:{藝人}」＝這位藝人的「周邊與其他」，第一次用到才建
 * - 系列裡已有這種品項就掛上去（itemId 可指定，要跟品項類型一致）；沒有就自動建品項（版本等人補）
 * - versionId 選填（不帶＝不確定）
 * - 不選系列＝「不確定」；pendingSeriesId＝這位會員剛新增、還在審核的系列，核准後自動改掛過去
 * 舊版表單（只帶 seriesKey＋itemId、不帶 kind）照樣收：kind 取該品項的類型。
 * 所有驗證過了才會建「周邊與其他」與品項，驗證失敗不留下任何新資料。
 */
async function resolveContent(owner: string, body: Record<string, unknown>, errors: Record<string, string>) {
  const about = strList(body.about, 10, 40);
  const tags = strList(body.tags, 10, 30);
  const story = typeof body.story === "string" ? body.story.trim().slice(0, 2000) : "";
  if (about.length === 0) errors.about = "至少點一位";
  const rawSeries = typeof body.seriesKey === "string" && body.seriesKey ? body.seriesKey : null;
  let itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : null;
  const versionId = typeof body.versionId === "string" && body.versionId ? body.versionId : null;
  let kind: Kind | null = (KINDS as readonly string[]).includes(String(body.kind)) ? (body.kind as Kind) : null;
  const kindNote = typeof body.kindNote === "string" ? body.kindNote.trim().slice(0, 30) || null : null;
  const db = getDb();

  /** 既有系列：{ id, title }；misc 延後到驗證全過才建 */
  let target: { id: number; key: string; title: string } | null = null;
  let miscArtist: string | null = null;
  let edition = "";
  let itemExists = false;
  if (rawSeries?.startsWith("misc:")) {
    miscArtist = rawSeries.slice(5);
    if (!/^[a-z0-9-]{1,60}$/.test(miscArtist)) errors.kind = "找不到這位藝人";
    if (itemId || versionId) errors.kind = "「周邊與其他」不用選版本";
  } else if (rawSeries) {
    const k = parseContentKey(rawSeries);
    const [w] = k && !k.itemId
      ? await db
          .select({ id: series.id, title: series.title })
          .from(series)
          .where(and(eq(series.artistSlug, k.artist), eq(series.no, k.no), eq(series.status, "approved"), isNull(series.deletedAt), isNull(series.hiddenAt)))
      : [];
    if (!w) errors.kind = "找不到這個系列";
    else {
      target = { id: w.id, key: rawSeries, title: w.title };
      if (itemId) {
        const [it] = await db
          .select({ kind: items.kind })
          .from(items)
          .where(and(eq(items.seriesId, w.id), eq(items.itemId, itemId), eq(items.status, "approved"), isNull(items.deletedAt), isNull(items.hiddenAt)));
        if (!it) errors.kind = "找不到這個品項";
        else if (kind && it.kind !== kind) errors.kind = "品項跟選的類型不一樣";
        else {
          kind = it.kind as Kind;
          itemExists = true;
        }
      }
      if (versionId) {
        if (!itemId) errors.kind = "選版本前要先有品項";
        else if (itemExists) {
          const ed = await versionEdition(w.id, itemId, versionId);
          if (ed === null) errors.kind = "找不到這個版本";
          else edition = ed;
        }
      }
    }
  }
  if (!kind && !errors.kind) errors.kind = "點一個品項";
  // 其他周邊要寫是什麼（掛到系列裡既有的「其他周邊」品項時可以不寫）
  if (kind === "其他周邊" && !kindNote && !itemExists) errors.kind = "寫一下是什麼周邊";
  const pending = !rawSeries && body.pendingSeriesId != null ? await ownPendingSeries(owner, body.pendingSeriesId) : null;
  if (!rawSeries && body.pendingSeriesId != null && !pending) errors.kind = "新增的系列找不到或已經審核過了，重新選一次";
  if (Object.keys(errors).length || !kind) {
    throw new HttpError(400, "INVALID", Object.values(errors)[0] ?? "有欄位沒填好");
  }

  // 驗證全過，才建「周邊與其他」與品項
  if (miscArtist) {
    const m = await ensureMiscSeries(miscArtist, owner);
    if (!m) throw new HttpError(404, "NOT_FOUND", "找不到這位藝人");
    target = m;
  }
  if (target && !itemExists) itemId = await ensureItem(target.id, kind, owner);

  const label = kind === "其他周邊" ? (kindNote ?? kind) : kind;
  const what = target
    ? composeWhat({ series: target.title, item: label, version: edition })
    : composeWhat({ about, kind: label });
  // 自訂標題（2026-09-28）：有填、而且跟自動組的不同才存；空白＝用自動標題
  const custom = typeof body.customTitle === "string" ? body.customTitle.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return {
    what,
    customWhat: custom && custom !== what ? custom : null,
    kind,
    kindNote: kind === "其他周邊" ? kindNote : null,
    story,
    about: JSON.stringify(about),
    tags: JSON.stringify(tags),
    seriesKey: target?.key ?? null,
    itemId: target ? itemId : null,
    versionId: target && edition ? versionId : null,
    pendingSeriesId: pending?.id ?? null,
  };
}

export async function createShare(u: User, body: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  if (Array.isArray(body.photoIds) && body.photoIds.length > MAX_SHARE_PHOTOS) {
    throw new HttpError(400, "TOO_MANY_PHOTOS", `一則最多 ${MAX_SHARE_PHOTOS} 張照片`);
  }
  const photoIds = strList(body.photoIds, MAX_SHARE_PHOTOS, 40);
  const sale = (body.sale ?? {}) as { state?: unknown; price?: unknown };
  const saleState: SaleState = sale.state === "offer" || sale.state === "sale" ? sale.state : "share";
  if (saleState === "sale" && !validPrice(sale.price)) errors.price = "填一個整數金額";

  const pics = await unattachedPhotos(u.id, photoIds, "share");
  if (pics.length === 0) errors.photo = "至少放一張照片";
  const content = await resolveContent(u.id, body, errors);
  const day = taiwanDay();
  if (!(await hit(`share:${u.id}:${day}`, SHARE_DAILY, 86400))) throw new HttpError(429, "RATE_LIMITED", `今天已經發了 ${SHARE_DAILY} 則，明天再來`);

  const db = getDb();
  const [created] = await db
    .insert(shares)
    .values({
      authorId: u.id,
      ...content,
      saleState,
      price: saleState === "sale" ? (sale.price as number) : null,
    })
    .returning({ no: shares.no });
  await db.batch(
    pics.map((p, i) =>
      db
        .update(photos)
        .set({ shareNo: created.no, sort: i })
        .where(and(eq(photos.id, p.id), isNull(photos.deletedAt))),
    ) as never,
  );
  return created.no;
}

/* ---------- 編輯已發布的內容（2026-09-28） ---------- */

/**
 * 發文者（或管理員）改內容：說明、標籤、跟誰有關、系列＞品項＞版本（可「不確定」）、出售狀態與價格，標題依同一套規則重組。
 * - 被鎖定（檢舉達門檻等）不能改；被隱藏、刪除的 shareRow 就找不到（404）
 * - 已成交：出售狀態與價格不能改（要改先「改回出售中」）
 * - 出售狀態與價格走 setSale 同一套規則：有人出價中也可以改價，每條對話插一行系統訊息通知出價者
 * - 管理員只能改內容欄位，出售狀態與價格只有發文者能改；管理員改別人的會寫操作紀錄
 * - 分數：發炫收藏的事件以這則的編號為準，改版本不會重複加分；版本頁的排序、統計都是讀這則目前掛的版本即時算
 */
export async function editShare(u: User, no: number, body: Record<string, unknown>, abroad = false) {
  const s = await shareRow(no);
  const admin = isAdmin(u);
  if (s.authorId !== u.id && !admin) throw new HttpError(403, "FORBIDDEN", "只有發文者可以編輯這則");
  // 合集有自己的編輯（lib/server/collections.ts），這支的欄位（品項、系列、出售狀態）合集都沒有
  assertNotCollection(s);
  const lock = await lockForShare(s);
  if (lock) throw new HttpError(423, "LOCKED", `${lock.label}，暫時不能編輯`);
  const errors: Record<string, string> = {};
  const content = await resolveContent(s.authorId, body, errors);
  const sale = body.sale as { state?: unknown; price?: unknown } | undefined;
  const saleChanged =
    sale !== undefined &&
    (sale.state !== s.saleState || (sale.state === "sale" && sale.price !== s.price));
  if (saleChanged && s.saleState === "sold") throw new HttpError(409, "SOLD", "已成交，出售狀態與價格不能改");
  if (saleChanged && s.authorId !== u.id) throw new HttpError(403, "FORBIDDEN", "出售狀態與價格只有發文者可以改");
  if (saleChanged && sale.state !== "share" && sale.state !== "offer" && sale.state !== "sale") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (saleChanged && sale.state === "sale" && !validPrice(sale.price)) throw new HttpError(400, "INVALID", "填一個整數金額");
  // 海外連線（2026-10-02 總檢 L10）：只有「真的要改成開放出價／定價出售」才擋，表單原樣送回來的 sale 不算交易
  if (saleChanged && sale.state !== "share" && abroad) throw new HttpError(403, "TRADE_REGION", TRADE_ONLY_MESSAGE);
  if (!(await hit(`edit-share:${u.id}`, 60, 3600))) throw new HttpError(429, "RATE_LIMITED", "改太多次了，等一下再試");

  const at = nowIso();
  const db = getDb();
  await db.update(shares).set({ ...content, updatedAt: at, editedAt: at }).where(eq(shares.no, no));
  if (saleChanged) await setSale(u, no, sale.state, sale.price);
  if (s.authorId !== u.id) {
    await db.insert(adminLog).values({
      adminId: u.id,
      action: "編輯別人的炫收藏",
      target: `share:${no}`,
      detail: JSON.stringify({ from: s.customWhat || s.what, to: content.customWhat || content.what }),
    });
  }
  return { what: content.customWhat || content.what, saleChanged };
}

/* ---------- 編輯照片（2026-09-28：一則最多 10 張，第一張是封面） ---------- */

/** 作者編輯用：這則目前的照片，依順序 */
export async function sharePhotoList(u: User, no: number) {
  const s = await shareRow(no);
  assertAuthor(s, u);
  const rows = await getDb()
    .select()
    .from(photos)
    .where(and(eq(photos.shareNo, no), isNull(photos.deletedAt)))
    .orderBy(asc(photos.sort), asc(photos.createdAt));
  return rows.map((r) => ({ id: r.id, url: `/img/${r.r2Key}`, thumbUrl: `/img/${r.thumbKey}`, og: Boolean(r.ogKey) }));
}

/**
 * 作者重排／補／刪照片：photoIds＝整份新順序（這則原有的＋自己剛上傳還沒掛的），至少 1 張、最多 10 張。
 * 不在清單裡的原有照片：R2 刪檔、容量扣回、清快取。封面換了：舊封面的預覽圖拿掉，
 * 回傳 needOg＝新封面還沒有預覽圖（前端畫好再 POST /api/uploads/og）。
 * 被鎖定（檢舉達門檻等）時不能動照片，照片可能是檢舉證據。
 */
export async function setSharePhotos(u: User, no: number, raw: unknown, origin: string) {
  const s = await shareRow(no);
  assertAuthor(s, u);
  const lock = await lockForShare(s);
  if (lock) throw new HttpError(423, "LOCKED", `${lock.label}，照片暫時不能改`);
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) throw new HttpError(400, "INVALID", "照片清單格式不對");
  const ids = raw as string[];
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "INVALID", "照片重複了");
  if (ids.length === 0) throw new HttpError(400, "INVALID", "至少放一張照片");
  if (ids.length > MAX_SHARE_PHOTOS) throw new HttpError(400, "TOO_MANY_PHOTOS", `一則最多 ${MAX_SHARE_PHOTOS} 張照片`);
  const db = getDb();
  const current = await db
    .select()
    .from(photos)
    .where(and(eq(photos.shareNo, no), isNull(photos.deletedAt)))
    .orderBy(asc(photos.sort), asc(photos.createdAt));
  const fresh = await unattachedPhotos(u.id, ids.filter((id) => !current.some((c) => c.id === id)), "share");
  const known = new Map([...current, ...fresh].map((r) => [r.id, r]));
  if (ids.some((id) => !known.has(id))) throw new HttpError(400, "INVALID", "有照片找不到，重新整理再試");

  const removed = current.filter((c) => !ids.includes(c.id));
  await db.batch(
    ids.map((id, i) =>
      db
        .update(photos)
        .set({ shareNo: no, sort: i })
        .where(and(eq(photos.id, id), eq(photos.ownerId, u.id), isNull(photos.deletedAt))),
    ) as never,
  );
  await db.update(shares).set({ editedAt: nowIso() }).where(eq(shares.no, no));
  const released = await removePhotoFiles(origin, removed);
  const oldCover = current[0]?.id ?? null;
  const coverChanged = oldCover !== ids[0];
  if (coverChanged) {
    // 預覽圖只留給封面：其他張身上還有的一律拿掉
    for (const r of [...current, ...fresh]) if (r.id !== ids[0] && r.ogKey && !removed.includes(r)) await dropOgImage(origin, r);
  }
  return { removed: removed.length, released, coverChanged, needOg: !known.get(ids[0])?.ogKey };
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

/** 這則還沒處理（open／accepted）的出價全部標撤回，各對話插一行系統訊息；回傳作廢幾筆與通知了哪些對話 */
async function voidOpenOffers(no: number, line: string) {
  const db = getDb();
  const live = await db
    .select({ id: offers.id, threadId: offers.threadId })
    .from(offers)
    .where(and(eq(offers.shareNo, no), inArray(offers.status, ["open", "accepted"])));
  const threadIds = new Set(live.map((o) => o.threadId));
  if (live.length) {
    await db
      .update(offers)
      .set({ status: "withdrawn", updatedAt: nowIso() })
      .where(inArray(offers.id, live.map((o) => o.id)));
    for (const t of threadIds) await sys(t, line);
  }
  return { offers: live.length, threadIds };
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
  assertNotCollection(s);
  if (s.saleState === "sold") throw new HttpError(409, "SOLD", "已售出，要先改回出售中");
  if (state !== "share" && state !== "offer" && state !== "sale") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (state === "sale" && !validPrice(price)) throw new HttpError(400, "INVALID", "填一個整數金額");
  // 改回純分享（下架）鎖定中也放行（2026-10-02 總檢 S9）；開放出價、定價、改價仍要沒被鎖
  if (state !== "share") await assertNotLocked(s);
  const nextPrice = state === "sale" ? (price as number) : null;
  if (state === s.saleState && nextPrice === (state === "sale" ? s.price : null)) return;
  await getDb()
    .update(shares)
    .set({ saleState: state, price: state === "sale" ? nextPrice : s.price, updatedAt: nowIso() })
    .where(eq(shares.no, no));
  if (state === "share") {
    // 不賣了：還沒處理的出價一併作廢（2026-10-02 總檢 S3），有出價的對話說明出價已作廢，其他對話照舊一句
    const { threadIds } = await voidOpenOffers(no, "這件不賣了，你的出價已作廢");
    await broadcast(no, (tid) => (threadIds.has(tid) ? null : stateWord.share));
    return;
  }
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
  await assertActive(s.authorId, "賣家帳號已停用，這則不能再出價");
  if (!(await hit(`offer:${u.id}`, 60, 3600))) throw new HttpError(429, "RATE_LIMITED", "出價太頻繁，等一下再試");
  const db = getDb();
  await assertNotBlocked(u.id, s.authorId);
  const t = await ensureThread(no, u.id);
  const live = await db
    .select()
    .from(offers)
    .where(and(eq(offers.shareNo, no), eq(offers.buyerId, u.id), inArray(offers.status, ["open", "accepted"])));
  if (kind === "buy" && live.some((o) => o.kind === "buy")) return t.id;
  await beforeSend(u, t, s.authorId);
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
  if (s.saleState !== "offer" && s.saleState !== "sale") throw new HttpError(409, "NOT_OPEN", "這則目前不開放交易，先改成開放出價或定價出售");
  if (o.status !== "open") throw new HttpError(409, "NOT_OPEN", "這筆出價已經處理過");
  await assertNotLocked(s);
  await getDb().update(offers).set({ status: answer, updatedAt: nowIso() }).where(eq(offers.id, id));
  await sys(o.threadId, `賣家${answer === "accepted" ? "接受" : "拒絕"}了 ${priceText(o.price)}`);
}

export async function withdrawOffer(u: User, id: number) {
  const { o, s } = await offerWithShare(id);
  if (o.buyerId !== u.id) throw new HttpError(403, "FORBIDDEN", "只有出價的人可以撤回");
  if (o.status !== "open") throw new HttpError(409, "NOT_OPEN", "這筆出價已經處理過");
  // 鎖定中照樣可以撤回（2026-10-02 總檢 S9）：買家把錢收回來是降低風險，不用等解鎖
  void s;
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
  if (s.saleState !== "offer" && s.saleState !== "sale") throw new HttpError(409, "NOT_OPEN", "這則目前不開放交易，不能成交");
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
  buyer: { handle: string; name: string; avatar?: string | null };
  /** 出價者的等級小標籤（「收藏家 Lv.3」／「館長」） */
  badge: string;
  /** 出價者所在地區（國家層級，例：台灣）；沒有紀錄是空字串 */
  region: string;
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
  const [names, regions, badges] = await Promise.all([userNames([...latest.keys()]), regionNames([...latest.keys()]), userBadges([...latest.keys()])]);
  const now = Date.now();
  return [...latest.values()]
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      threadId: r.threadId,
      buyer: names.get(r.buyerId) ?? { handle: "", name: "（已刪除）" },
      badge: badges.get(r.buyerId) ?? "",
      region: regions.get(r.buyerId) ?? "",
      kind: r.kind as PublicOffer["kind"],
      price: r.price,
      status: r.status as PublicOffer["status"],
      time: relTime(r.createdAt, now),
    }));
}

/* ---------- 私訊 ---------- */

/** 問賣家／私訊（單則頁）：開一條綁這則收藏的對話但不出價。純分享、已售出的也可以 */
export async function openThread(u: User, no: number) {
  const s = await shareRow(no);
  if (s.authorId === u.id) throw new HttpError(403, "FORBIDDEN", "這是你自己的收藏");
  assertVerified(u);
  await assertActive(s.authorId, "賣家帳號已停用，無法再私訊");
  const [found] = await getDb()
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.shareNo, no), eq(threads.buyerId, u.id)));
  if (found) return found.id;
  await assertNotBlocked(u.id, s.authorId);
  return (await ensureThread(no, u.id)).id;
}

type ThreadRow = typeof threads.$inferSelect;

/** 對話的另一方：收藏相關＝買家↔作者；直接私訊＝發起人↔對方 */
const otherOf = (t: ThreadRow, authorId: string | null, meId: string) => {
  const b = t.shareNo > 0 ? (authorId ?? "") : (t.peerId ?? "");
  return t.buyerId === meId ? b : t.buyerId;
};

async function threadFor(u: User, id: number) {
  const db = getDb();
  const [row] = await db
    .select({ t: threads, authorId: shares.authorId })
    .from(threads)
    .leftJoin(shares, eq(shares.no, threads.shareNo))
    .where(eq(threads.id, id));
  if (!row) throw new HttpError(404, "NOT_FOUND", "找不到這段對話");
  const direct = row.t.shareNo === 0;
  const second = direct ? row.t.peerId : row.authorId;
  if (row.t.buyerId !== u.id && second !== u.id) throw new HttpError(404, "NOT_FOUND", "找不到這段對話");
  return { ...row.t, direct, sellerId: second ?? "", otherId: otherOf(row.t, row.authorId, u.id) };
}

export async function sendText(u: User, id: number, text: unknown) {
  const t = await threadFor(u, id);
  const body = typeof text === "string" ? text.trim().slice(0, 1000) : "";
  if (!body) throw new HttpError(400, "INVALID", "寫點什麼再送出");
  assertVerified(u);
  await assertActive(t.otherId, "對方帳號已停用，無法再傳訊息");
  if (!(await hit(`msg:${u.id}`, 120, 3600))) throw new HttpError(429, "RATE_LIMITED", "訊息太頻繁，等一下再試");
  await beforeSend(u, t, t.otherId);
  const db = getDb();
  await db.insert(messages).values({ threadId: t.id, fromId: u.id, text: body });
  await db.update(threads).set({ updatedAt: nowIso() }).where(eq(threads.id, t.id));
}

/** 檢舉對話的另一方（不讀內容） */
export async function reportThreadOf(u: User, id: number, reason: unknown, note: unknown) {
  const t = await threadFor(u, id);
  await reportThread(u, t, t.otherId, reason, note);
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

export type ThreadRowView = {
  id: number;
  /** 0＝直接私訊 */
  shareNo: number;
  what: string;
  thumb: string | null;
  iAmSeller: boolean;
  other: { handle: string; name: string; avatar: string | null };
  otherRegion: string;
  lastFrom: string;
  preview: string;
  time: string;
  /** 對方（或系統）比我讀到的新的訊息則數 */
  unread: number;
};

/** 我的對話列表：收藏相關與直接私訊放一起，依最新一則訊息排序 */
export async function myThreads(u: User): Promise<ThreadRowView[]> {
  const db = getDb();
  const list = await db
    .select({ t: threads, authorId: shares.authorId, what: sql<string | null>`coalesce(${shares.customWhat}, ${shares.what})` })
    .from(threads)
    .leftJoin(shares, eq(shares.no, threads.shareNo))
    .where(or(eq(threads.buyerId, u.id), eq(threads.peerId, u.id), and(sql`${threads.shareNo} > 0`, eq(shares.authorId, u.id))))
    .orderBy(desc(threads.updatedAt));
  if (!list.length) return [];
  const ids = list.map((x) => x.t.id);
  const msgs: (typeof messages.$inferSelect)[] = [];
  const reads: (typeof threadReads.$inferSelect)[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const [m, r] = await db.batch([
      db.select().from(messages).where(inArray(messages.threadId, part)).orderBy(asc(messages.id)),
      db.select().from(threadReads).where(and(eq(threadReads.userId, u.id), inArray(threadReads.threadId, part))),
    ]);
    msgs.push(...m);
    reads.push(...r);
  }
  const offerIds = msgs.map((m) => m.offerId).filter((x): x is number => x !== null);
  const offerRows: (typeof offers.$inferSelect)[] = [];
  for (let i = 0; i < offerIds.length; i += 90) offerRows.push(...(await db.select().from(offers).where(inArray(offers.id, offerIds.slice(i, i + 90)))));
  const others = list.map((x) => otherOf(x.t, x.authorId, u.id));
  const [names, regions] = await Promise.all([userNames([...others, ...msgs.map((m) => m.fromId ?? "")]), regionNames(others)]);
  const nos = Array.from(new Set(list.map((x) => x.t.shareNo).filter((n) => n > 0)));
  const pics: { n: number | null; key: string | null }[] = [];
  for (let i = 0; i < nos.length; i += 90)
    pics.push(
      ...(await db
        .select({ n: photos.shareNo, key: photos.thumbKey })
        .from(photos)
        .where(and(inArray(photos.shareNo, nos.slice(i, i + 90)), isNull(photos.deletedAt)))
        .orderBy(asc(photos.sort))),
    );
  const now = Date.now();
  const byThread = new Map<number, (typeof msgs)[number][]>();
  msgs.forEach((m) => byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]));
  return list
    .map(({ t, authorId, what }, i) => {
      const mine = byThread.get(t.id) ?? [];
      const last = [...mine].reverse().find((m) => m.fromId !== null);
      const newest = mine[mine.length - 1];
      const read = reads.find((r) => r.threadId === t.id)?.lastMessageId ?? 0;
      const unread = mine.filter((m) => m.id > read && m.fromId !== u.id).length;
      const direct = t.shareNo === 0;
      const otherId = others[i];
      const lo = last?.offerId ? offerRows.find((o) => o.id === last.offerId) : undefined;
      const pic = direct ? undefined : pics.find((p) => p.n === t.shareNo && p.key);
      return {
        row: {
          id: t.id,
          shareNo: t.shareNo,
          what: direct ? "" : (what ?? ""),
          thumb: pic?.key ? `/img/${pic.key}` : null,
          iAmSeller: !direct && authorId === u.id,
          other: names.get(otherId) ?? { handle: "", name: "（已刪除）", avatar: null },
          otherRegion: regions.get(otherId) ?? "",
          lastFrom: last?.fromId ? (last.fromId === u.id ? "你" : (names.get(last.fromId)?.name ?? "")) : "",
          preview: lo ? `${lo.kind === "buy" ? "我要買" : "出價"} ${priceText(lo.price)}` : (last?.text ?? ""),
          time: newest ? relTime(newest.createdAt, now) : "",
          unread,
        },
        order: newest?.id ?? 0,
        empty: mine.length === 0,
      };
    })
    .filter((x) => !x.empty)
    .sort((a, b) => b.order - a.order)
    .map((x) => x.row);
}

export async function threadDetail(u: User, id: number) {
  const t = await threadFor(u, id);
  const db = getDb();
  const msgs = await db.select().from(messages).where(eq(messages.threadId, id)).orderBy(asc(messages.id));
  const offerIds = msgs.map((m) => m.offerId).filter((x): x is number => x !== null);
  const offerRows = offerIds.length ? await db.select().from(offers).where(inArray(offers.id, offerIds)) : [];
  const [names, regions, blocked, reported, otherRow] = await Promise.all([
    userNames([t.buyerId, t.sellerId]),
    regionNames([t.buyerId, t.sellerId]),
    blockState(u.id, t.otherId),
    reportedThreads(u.id, [t.id]),
    t.otherId ? db.select({ status: users.status }).from(users).where(eq(users.id, t.otherId)) : Promise.resolve([]),
  ]);
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
  const gone = { handle: "", name: "（已刪除）", avatar: null };
  return {
    id: t.id,
    shareNo: t.shareNo,
    direct: t.direct,
    iAmSeller: !t.direct && t.sellerId === u.id,
    buyer: names.get(t.buyerId) ?? gone,
    seller: names.get(t.sellerId) ?? gone,
    other: names.get(t.otherId) ?? gone,
    buyerRegion: regions.get(t.buyerId) ?? "",
    sellerRegion: regions.get(t.sellerId) ?? "",
    otherRegion: regions.get(t.otherId) ?? "",
    /** me＝我封鎖對方、them＝對方封鎖我 */
    blocked,
    reported: reported.has(t.id),
    /** 對方帳號已停權或刪除（2026-10-02 總檢 M3）：畫面顯示「對方帳號已停用」、不能再傳 */
    otherGone: !otherRow[0] || otherRow[0].status !== "active",
    messages: out,
  };
}

/* ---------- 刪除收藏（2026-10-02 總檢 M1） ---------- */

/**
 * 作者刪除自己的收藏（使用條款第 15 條「想刪除特定內容，請在申請刪帳前自己刪除」）。
 * - 軟刪除：shares.deleted_at，列保留；頁面 404、目錄與 sitemap 自動不含、分數在下次彙總時作廢（scores.ts 的 BASE_REASON 看 deleted_at）
 * - 照片照「刪帳時勾選連同照片刪除」同一套：R2 檔（主圖、縮圖、預覽圖、原圖）刪掉、容量扣回、快取清掉（photos.ts removePhotoFiles）
 * - 還沒處理的出價作廢、每條對話插一行系統訊息
 * - 被鎖定（檢舉達門檻）不能刪：照片可能是檢舉證據，要先申訴或請管理員處理
 */
export async function deleteShare(u: User, no: number, origin: string) {
  const s = await shareRow(no);
  assertAuthor(s, u);
  const lock = await lockForShare(s);
  if (lock) throw new HttpError(423, "LOCKED", `${lock.label}，照片可能是檢舉證據，暫時不能刪除；請先申訴，或寫信請我們處理`);
  const db = getDb();
  const at = nowIso();
  const pics = await db.select().from(photos).where(and(eq(photos.shareNo, no), isNull(photos.deletedAt)));
  const { threadIds, offers: voided } = await voidOpenOffers(no, "作者已刪除這則收藏，你的出價已作廢");
  await db.update(shares).set({ deletedAt: at, updatedAt: at }).where(eq(shares.no, no));
  await broadcast(no, (tid) => (threadIds.has(tid) ? null : "作者已刪除這則收藏"));
  const released = await removePhotoFiles(origin, pics);
  return { no, photos: pics.length, bytesReleased: released, offersVoided: voided };
}

/* ---------- 停權、刪帳時收掉交易（2026-10-02 總檢 M3） ---------- */

/**
 * 這位會員名下出售中的收藏改成純分享、他收藏上還沒處理的出價全部撤回；他當買家還沒處理的出價也撤回。
 * 每條受影響的對話插一行系統訊息說明。回傳改了幾則收藏、撤回幾筆出價。
 */
export async function freezeUserTrade(userId: string, why: "suspended" | "deleted") {
  const db = getDb();
  const at = nowIso();
  const word = why === "suspended" ? "停用" : "刪除";
  const selling = await db
    .select({ no: shares.no })
    .from(shares)
    .where(and(eq(shares.authorId, userId), isNull(shares.deletedAt), inArray(shares.saleState, ["offer", "sale"])));
  if (selling.length) {
    await db
      .update(shares)
      .set({ saleState: "share", updatedAt: at })
      .where(inArray(shares.no, selling.map((x) => x.no)));
  }
  // 他收藏上還沒處理的出價（含舊資料裡純分享狀態下殘留的 open）
  const withOffers = await db
    .select({ no: offers.shareNo })
    .from(offers)
    .innerJoin(shares, eq(shares.no, offers.shareNo))
    .where(and(eq(shares.authorId, userId), inArray(offers.status, ["open", "accepted"])))
    .groupBy(offers.shareNo);
  let n = 0;
  for (const { no } of withOffers) n += (await voidOpenOffers(no, `賣家帳號已${word}，這件不再開放交易，你的出價已撤回`)).offers;
  // 出售中但沒人出價的收藏，也在既有對話裡說一聲
  for (const { no } of selling) {
    if (!withOffers.some((x) => x.no === no)) await broadcast(no, () => `賣家帳號已${word}，這件不再開放交易`);
  }
  // 他當買家還沒處理的出價
  const mine = await db
    .select({ id: offers.id, threadId: offers.threadId })
    .from(offers)
    .where(and(eq(offers.buyerId, userId), inArray(offers.status, ["open", "accepted"])));
  if (mine.length) {
    await db
      .update(offers)
      .set({ status: "withdrawn", updatedAt: at })
      .where(inArray(offers.id, mine.map((o) => o.id)));
    for (const t of new Set(mine.map((o) => o.threadId))) await sys(t, `買家帳號已${word}，出價已撤回`);
  }
  return { shares: selling.length, offers: n + mine.length };
}
