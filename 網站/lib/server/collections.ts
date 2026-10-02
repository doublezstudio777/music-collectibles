// 全家福合集（2026-10-01 一次發多張）：一張或幾張大合照＋一段說明＋標記裡面有哪些專輯。
//
// 合集就是一則 shares（post_type='collection'），所以照片、浮水印、查證碼、讚、留言、檢舉、隱藏下架、刪帳重燒、
// sitemap 全部照一般收藏那一套走；不同的只有：
// - 不掛系列／品項／版本（series_key 是 NULL），改在 collection_tags 一列一個標記
// - 純展示：出售狀態永遠是 share，trade.ts 的 assertNotCollection 擋改狀態、編輯一般欄位
// - 「跟誰有關」由標記的專輯自動帶出（署名藝人），首頁追蹤中、藝人頁相關收藏照常找得到
// - 標題自動組「Hyukoh、ADOY・合集 8 張」，發文者可以自己改
// 標記的鍵：系列鍵（不確定版本）、品項鍵或版本鍵；照片上的位置選填（photo_id＋x、y 比例）。

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { collectionTags, photos, shares } from "@/db/schema";
import type { Catalog } from "@/lib/catalog";
import type { User } from "@/lib/server/auth";
import { isAdmin } from "@/lib/server/auth";
import { getCatalog, lockForShare } from "@/lib/server/content";
import { holdingLevel, validHoldingKey } from "@/lib/server/me";
import { MAX_SHARE_PHOTOS, unattachedPhotos } from "@/lib/server/photos";
import { hit, taiwanDay } from "@/lib/server/services";
import { HttpError, shareRow, SHARE_DAILY } from "@/lib/server/trade";
import { collectionWhat } from "@/lib/data";

/** 一則合集最多標幾張 */
export const MAX_COLLECTION_TAGS = 60;

type TagIn = { key: string; photo: string | null; x: number | null; y: number | null };

const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : null);

/** 標記清單：格式、數量、存在、照片位置都在這裡驗 */
function readTags(c: Catalog, raw: unknown, photoIds: string[]): TagIn[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "INVALID", "標記格式不對");
  if (raw.length === 0) throw new HttpError(400, "INVALID", "至少標一張專輯");
  if (raw.length > MAX_COLLECTION_TAGS) throw new HttpError(400, "INVALID", `一則合集最多標 ${MAX_COLLECTION_TAGS} 張`);
  const seen = new Set<string>();
  const out: TagIn[] = [];
  for (const t of raw as Record<string, unknown>[]) {
    const key = t?.key;
    if (!validHoldingKey(key)) throw new HttpError(400, "INVALID", "標記格式不對");
    if (seen.has(key)) continue;
    const lv = holdingLevel(key);
    const ok = lv === "series" ? c.getSeriesByKey(key) : lv === "item" ? c.resolveItemKey(key) : c.resolveVersionKey(key);
    if (!ok) throw new HttpError(404, "NOT_FOUND", "有一張專輯找不到了，重新整理再試");
    seen.add(key);
    const photo = typeof t.photo === "string" && photoIds.includes(t.photo) ? t.photo : null;
    const x = unit(t.x);
    const y = unit(t.y);
    // 位置三個值要齊全才算有標在照片上，缺一個就當只列清單
    out.push(photo && x !== null && y !== null ? { key, photo, x, y } : { key, photo: null, x: null, y: null });
  }
  return out;
}

/** 標記的專輯署名藝人（去重、照標記順序），當「跟誰有關」 */
function aboutOf(c: Catalog, tags: TagIn[]) {
  const names: string[] = [];
  for (const t of tags) {
    const w = c.getSeriesByKey(t.key.split("#")[0]);
    for (const a of w ? c.creditNames(w) : []) if (!names.includes(a.name)) names.push(a.name);
  }
  return names;
}

const story = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 2000) : "");
const custom = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 80) : "");

const tagRows = (no: number, tags: TagIn[]) =>
  tags.map((t, i) => ({ shareNo: no, targetKey: t.key, sort: i, photoId: t.photo, x: t.x, y: t.y }));

/** 發布合集：{ photoIds, story, customTitle?, tags: [{ key, photo?, x?, y? }] } → 新的流水號 */
export async function createCollection(u: User, body: Record<string, unknown>) {
  const ids = Array.isArray(body.photoIds) ? body.photoIds.filter((x): x is string => typeof x === "string").slice(0, MAX_SHARE_PHOTOS + 1) : [];
  if (ids.length > MAX_SHARE_PHOTOS) throw new HttpError(400, "TOO_MANY_PHOTOS", `一則最多 ${MAX_SHARE_PHOTOS} 張照片`);
  const pics = await unattachedPhotos(u.id, Array.from(new Set(ids)), "share");
  if (!pics.length) throw new HttpError(400, "INVALID", "至少放一張合照");
  const c = await getCatalog();
  const tags = readTags(c, body.tags, pics.map((p) => p.id));
  const about = aboutOf(c, tags);
  const what = collectionWhat(about, tags.length);
  const title = custom(body.customTitle);
  const day = taiwanDay();
  if (!(await hit(`share:${u.id}:${day}`, SHARE_DAILY, 86400))) throw new HttpError(429, "RATE_LIMITED", `今天已經發了 ${SHARE_DAILY} 則，明天再來`);

  const db = getDb();
  const [created] = await db
    .insert(shares)
    .values({
      authorId: u.id,
      postType: "collection",
      what,
      customWhat: title && title !== what ? title : null,
      kind: "其他周邊",
      kindNote: "合集",
      story: story(body.story),
      about: JSON.stringify(about.slice(0, 10)),
      tags: "[]",
      saleState: "share",
    })
    .returning({ no: shares.no });
  await db.batch([
    ...pics.map((p, i) => db.update(photos).set({ shareNo: created.no, sort: i }).where(and(eq(photos.id, p.id), isNull(photos.deletedAt)))),
    db.insert(collectionTags).values(tagRows(created.no, tags)),
  ] as never);
  return created.no;
}

/**
 * 編輯合集：說明、標題、標記（整份換掉）。照片的增刪換順序走既有的 PUT /api/shares/{n}/photos（合集也是一則 shares）。
 * 只有發文者；被鎖定（檢舉達門檻）時不能改
 */
export async function editCollection(u: User, no: number, body: Record<string, unknown>) {
  const s = await shareRow(no);
  if (s.postType !== "collection") throw new HttpError(409, "NOT_COLLECTION", "這則不是合集");
  if (s.authorId !== u.id && !isAdmin(u)) throw new HttpError(403, "FORBIDDEN", "只有發文者可以編輯這則");
  const lock = await lockForShare(s);
  if (lock) throw new HttpError(423, "LOCKED", `${lock.label}，暫時不能編輯`);
  if (!(await hit(`edit-share:${u.id}`, 60, 3600))) throw new HttpError(429, "RATE_LIMITED", "改太多次了，等一下再試");
  const db = getDb();
  const own = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.shareNo, no), isNull(photos.deletedAt)));
  const c = await getCatalog();
  const tags = readTags(c, body.tags, own.map((p) => p.id));
  const about = aboutOf(c, tags);
  const what = collectionWhat(about, tags.length);
  const title = custom(body.customTitle);
  const at = new Date().toISOString();
  await db.batch([
    db
      .update(shares)
      .set({ what, customWhat: title && title !== what ? title : null, story: story(body.story), about: JSON.stringify(about.slice(0, 10)), updatedAt: at, editedAt: at })
      .where(eq(shares.no, no)),
    db.delete(collectionTags).where(eq(collectionTags.shareNo, no)),
    db.insert(collectionTags).values(tagRows(no, tags)),
  ] as never);
  return { what: title || what };
}

/** 編輯頁用：這則合集目前的標記（照順序） */
export async function collectionTagList(no: number) {
  return getDb()
    .select({ key: collectionTags.targetKey, photo: collectionTags.photoId, x: collectionTags.x, y: collectionTags.y })
    .from(collectionTags)
    .where(eq(collectionTags.shareNo, no))
    .orderBy(collectionTags.sort);
}
