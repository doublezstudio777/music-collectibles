// 藝人照片（2026-09-28）。
//
// - 藝人頁上方一張「目前使用中」（artist_photos.status=active，每位藝人最多一張，部分唯一索引保證）
// - 來源：維基共享資源匯入（scripts/import-artist-photos.mjs，本機縮圖後上傳 R2 `r/`），或會員投稿
// - 會員投稿：要登入、Email 已驗證，必勾「本人拍攝」「同意以 CC BY-SA 4.0 授權」；瀏覽器端壓縮（規格同收藏照片：
//   主圖長邊 1600＋縮圖 480），每人每日（台灣日期）最多 5 張；投稿不公開（/img/ 只給投稿者本人與管理員），進後台佇列
// - 後台：設為使用中（原本使用中的改成 retired，檔案保留可再設回）、退回、刪除、一鍵撤下；退回／刪除／撤下都從 R2 刪檔、
//   容量扣回、清照片快取。每個操作寫 admin_log
// - 整頁快取：artist_photos 的觸發器只在「使用中」那張有變動時把 content_version 加 1，投稿與退回不會讓整頁快取作廢
// - 計分：投稿第一次被設為使用中 +15（比照新增並經核准），由 scores.ts 排程補事件

import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, artistPhotos, artists, users } from "@/db/schema";
import { randomToken } from "@/lib/server/crypto";
import { dimensions, isPaused, MAX_MAIN_BYTES, MAX_THUMB_BYTES, purgePhotoCache, releaseBytes, reserveBytes, sniff } from "@/lib/server/photos";
import { HttpError } from "@/lib/server/trade";
import type { User } from "@/lib/server/auth";

export const ARTIST_PHOTO_DAILY = 5;
export const MEMBER_LICENSE = "CC BY-SA 4.0";
export const MEMBER_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hant";

type Row = typeof artistPhotos.$inferSelect;

export type ArtistPhoto = {
  id: number;
  url: string;
  width: number;
  height: number;
  contentType: string;
  source: "wiki" | "member";
  author: string;
  authorUrl: string | null;
  license: string;
  licenseUrl: string | null;
  sourceUrl: string | null;
};

const toPublic = (r: Row): ArtistPhoto => ({
  id: r.id,
  url: `/img/${r.r2Key}`,
  width: r.width,
  height: r.height,
  contentType: r.contentType,
  source: r.source === "wiki" ? "wiki" : "member",
  author: r.author,
  authorUrl: r.authorUrl,
  license: r.license,
  licenseUrl: r.licenseUrl,
  sourceUrl: r.sourceUrl,
});

/** 藝人頁用：目前使用中的那張（沒有回 null）。一次小查詢，走索引。投稿者的攝影標示用當下的帳號名（@handle） */
export async function activeArtistPhoto(slug: string): Promise<ArtistPhoto | null> {
  const [r] = await getDb()
    .select({ p: artistPhotos, handle: users.handle, deleted: users.deletedAt })
    .from(artistPhotos)
    .leftJoin(users, eq(users.id, artistPhotos.submitterId))
    .where(and(eq(artistPhotos.artistSlug, slug), eq(artistPhotos.status, "active")))
    .limit(1);
  if (!r) return null;
  const out = toPublic(r.p);
  if (r.p.source === "member") {
    if (r.handle && !r.deleted) {
      out.author = `@${r.handle}`;
      out.authorUrl = `/u/${r.handle}`;
    } else {
      out.author = "已刪除的會員";
      out.authorUrl = null;
    }
  }
  return out;
}

/** 台灣日期當天 00:00 的 UTC ISO 字串 */
function twDayStart(now = Date.now()) {
  const tw = new Date(now + 8 * 3600_000);
  return new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600_000).toISOString();
}

export async function todaySubmissions(userId: string) {
  const r = await env
    .DB!.prepare("SELECT COUNT(*) AS n FROM artist_photos WHERE submitter_id = ?1 AND created_at >= ?2")
    .bind(userId, twDayStart())
    .first<{ n: number }>();
  return r?.n ?? 0;
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** 會員投稿：multipart image（主圖）＋ thumb（縮圖）＋ artist、own、license（"1"）、occasion、date */
export async function submitArtistPhoto(u: User, form: FormData) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "NOT_VERIFIED", "驗證 Email 後才能投稿");
  const slug = clip(form.get("artist"), 120);
  const [a] = await getDb()
    .select({ slug: artists.slug })
    .from(artists)
    .where(and(eq(artists.slug, slug), eq(artists.status, "approved"), sql`${artists.deletedAt} IS NULL`, sql`${artists.hiddenAt} IS NULL`));
  if (!a) throw new HttpError(404, "NOT_FOUND", "找不到這位藝人");
  if (form.get("own") !== "1" || form.get("license") !== "1") {
    throw new HttpError(400, "AGREE_REQUIRED", "兩項都要勾選才能投稿");
  }
  const occasion = clip(form.get("occasion"), 100);
  const date = clip(form.get("date"), 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "BAD_DATE", "日期格式不對");
  if (await isPaused()) throw new HttpError(503, "UPLOAD_PAUSED", "上傳暫停");
  const pick = (k: string) => {
    const v = form.get(k);
    return v && typeof v !== "string" ? (v as File) : null;
  };
  const main = pick("image");
  const thumb = pick("thumb");
  if (!main || !thumb) throw new HttpError(400, "BAD_REQUEST", "缺照片檔");
  if (main.size > MAX_MAIN_BYTES || thumb.size > MAX_THUMB_BYTES) throw new HttpError(413, "TOO_LARGE", "照片太大，換一張再試");
  const mainBytes = new Uint8Array(await main.arrayBuffer());
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
  const type = sniff(mainBytes);
  const tType = sniff(thumbBytes);
  if (!type || !tType) throw new HttpError(415, "BAD_FORMAT", "只收 WebP 或 JPEG 照片");
  if ((await todaySubmissions(u.id)) >= ARTIST_PHOTO_DAILY) {
    throw new HttpError(429, "DAILY_LIMIT", `藝人照片一天最多投稿 ${ARTIST_PHOTO_DAILY} 張，明天再來`);
  }
  const bytes = mainBytes.length + thumbBytes.length;
  if (!(await reserveBytes(bytes))) throw new HttpError(507, "STORAGE_FULL", "上傳暫停");
  const bucket = env.PHOTOS;
  if (!bucket) {
    await releaseBytes(bytes);
    throw new HttpError(503, "NO_STORAGE", "照片儲存還沒設定");
  }
  const id = randomToken(12);
  const key = `r/${id}.${type === "image/webp" ? "webp" : "jpg"}`;
  const thumbKey = `r/${id}_t.${tType === "image/webp" ? "webp" : "jpg"}`;
  try {
    await bucket.put(key, mainBytes, { httpMetadata: { contentType: type } });
    await bucket.put(thumbKey, thumbBytes, { httpMetadata: { contentType: tType } });
  } catch {
    await bucket.delete([key, thumbKey]).catch(() => undefined);
    await releaseBytes(bytes);
    throw new HttpError(502, "STORAGE_ERROR", "照片存不進去，再試一次");
  }
  const { width, height } = dimensions(mainBytes, type);
  const [row] = await getDb()
    .insert(artistPhotos)
    .values({
      artistSlug: a.slug,
      source: "member",
      status: "pending",
      r2Key: key,
      thumbKey,
      contentType: type,
      bytes,
      width,
      height,
      submitterId: u.id,
      author: u.name,
      authorUrl: `/u/${u.handle}`,
      license: MEMBER_LICENSE,
      licenseUrl: MEMBER_LICENSE_URL,
      occasion,
      occasionDate: date,
      agreedAt: new Date().toISOString(),
    })
    .returning({ id: artistPhotos.id });
  return { id: row.id, status: "pending" as const, left: ARTIST_PHOTO_DAILY - (await todaySubmissions(u.id)) };
}

/* ---------- 後台 ---------- */

const FILE_GONE = new Set(["rejected", "removed", "deleted"]);

/** 從 R2 刪檔、容量扣回、清照片快取。回傳清掉快取幾個 */
async function dropFiles(origin: string, r: Row) {
  const keys = [...new Set([r.r2Key, r.thumbKey])];
  await env.PHOTOS?.delete(keys).catch(() => undefined);
  await releaseBytes(r.bytes);
  return purgePhotoCache(origin, keys);
}

export type AdminArtistPhoto = {
  id: number;
  artist: { slug: string; name: string };
  source: string;
  status: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
  author: string;
  authorUrl: string | null;
  license: string;
  licenseUrl: string | null;
  sourceUrl: string | null;
  submitter: { handle: string; name: string } | null;
  occasion: string;
  occasionDate: string;
  createdAt: string;
  handledAt: string | null;
  note: string;
};

/** 後台清單：待審全部＋使用中全部＋最近處理的 100 筆 */
export async function adminArtistPhotos() {
  const db = getDb();
  const cols = {
    p: artistPhotos,
    name: artists.name,
    handle: users.handle,
    uname: users.name,
  };
  const base = () =>
    db
      .select(cols)
      .from(artistPhotos)
      .leftJoin(artists, eq(artists.slug, artistPhotos.artistSlug))
      .leftJoin(users, eq(users.id, artistPhotos.submitterId));
  const [pending, active, other] = await Promise.all([
    base().where(eq(artistPhotos.status, "pending")).orderBy(artistPhotos.id),
    base().where(eq(artistPhotos.status, "active")).orderBy(desc(artistPhotos.id)),
    base()
      .where(inArray(artistPhotos.status, ["retired", "rejected", "removed", "deleted"]))
      .orderBy(desc(sql`COALESCE(${artistPhotos.handledAt}, ${artistPhotos.createdAt})`))
      .limit(100),
  ]);
  const map = (x: (typeof pending)[number]): AdminArtistPhoto => ({
    id: x.p.id,
    artist: { slug: x.p.artistSlug, name: x.name ?? x.p.artistSlug },
    source: x.p.source,
    status: x.p.status,
    url: `/img/${x.p.r2Key}`,
    thumbUrl: `/img/${x.p.thumbKey}`,
    width: x.p.width,
    height: x.p.height,
    bytes: x.p.bytes,
    author: x.p.author,
    authorUrl: x.p.authorUrl,
    license: x.p.license,
    licenseUrl: x.p.licenseUrl,
    sourceUrl: x.p.sourceUrl,
    submitter: x.handle ? { handle: x.handle, name: x.uname ?? x.handle } : null,
    occasion: x.p.occasion,
    occasionDate: x.p.occasionDate,
    createdAt: x.p.createdAt,
    handledAt: x.p.handledAt,
    note: x.p.note,
  });
  return { pending: pending.map(map), active: active.map(map), other: other.map(map) };
}

export async function pendingArtistPhotoCount() {
  const r = await env.DB!.prepare("SELECT COUNT(*) AS n FROM artist_photos WHERE status = 'pending'").first<{ n: number }>();
  return r?.n ?? 0;
}

export type ArtistPhotoAction = "activate" | "reject" | "delete" | "remove";
const ACTION_LABEL: Record<ArtistPhotoAction, string> = {
  activate: "藝人照片設為使用中",
  reject: "退回藝人照片投稿",
  delete: "刪除藝人照片",
  remove: "撤下藝人照片",
};

/**
 * 後台操作。
 * - activate：待審或被替換下來的 → 使用中；同一位藝人原本使用中的那張改成 retired（檔案保留）。維基的照片也能被投稿取代
 * - reject：待審 → 退回，檔案刪除
 * - delete：待審、被替換下來、已退回的 → 刪除（還有檔案就刪檔）；使用中的要用 remove
 * - remove：使用中（或被替換下來）的 → 撤下（藝人或經紀公司要求），檔案刪除，藝人頁回到沒有照片
 */
export async function artistPhotoAction(admin: User, origin: string, id: number, action: ArtistPhotoAction, note = "") {
  const db = getDb();
  const [r] = await db.select().from(artistPhotos).where(eq(artistPhotos.id, id));
  if (!r) throw new HttpError(404, "NOT_FOUND", "找不到這張照片");
  const at = new Date().toISOString();
  const detail: Record<string, unknown> = { id, from: r.status, source: r.source, key: r.r2Key, note };
  let purged = 0;
  if (action === "activate") {
    if (r.status !== "pending" && r.status !== "retired") throw new HttpError(409, "BAD_STATE", "這張照片不能設為使用中");
    const [cur] = await db
      .select({ id: artistPhotos.id })
      .from(artistPhotos)
      .where(and(eq(artistPhotos.artistSlug, r.artistSlug), eq(artistPhotos.status, "active")));
    const d1 = env.DB!;
    // 同一個 batch（交易）：先把舊的換下來，再設新的，部分唯一索引不會撞
    await d1.batch([
      d1.prepare("UPDATE artist_photos SET status = 'retired', handled_at = ?1, handled_by = ?2 WHERE artist_slug = ?3 AND status = 'active'").bind(at, admin.id, r.artistSlug),
      d1
        .prepare("UPDATE artist_photos SET status = 'active', activated_at = COALESCE(activated_at, ?1), handled_at = ?1, handled_by = ?2, note = ?3 WHERE id = ?4")
        .bind(at, admin.id, note, id),
    ]);
    if (cur) detail.replaced = cur.id;
  } else if (action === "reject") {
    if (r.status !== "pending") throw new HttpError(409, "BAD_STATE", "只有待審的投稿可以退回");
    await db.update(artistPhotos).set({ status: "rejected", handledAt: at, handledBy: admin.id, note }).where(eq(artistPhotos.id, id));
    purged = await dropFiles(origin, r);
  } else if (action === "delete") {
    if (r.status === "active") throw new HttpError(409, "BAD_STATE", "使用中的照片請用「撤下」");
    if (r.status === "deleted") throw new HttpError(409, "BAD_STATE", "已經刪除了");
    await db.update(artistPhotos).set({ status: "deleted", handledAt: at, handledBy: admin.id, note }).where(eq(artistPhotos.id, id));
    if (!FILE_GONE.has(r.status)) purged = await dropFiles(origin, r);
  } else if (action === "remove") {
    if (r.status !== "active" && r.status !== "retired") throw new HttpError(409, "BAD_STATE", "只有使用中或被替換下來的照片可以撤下");
    await db.update(artistPhotos).set({ status: "removed", handledAt: at, handledBy: admin.id, note }).where(eq(artistPhotos.id, id));
    purged = await dropFiles(origin, r);
  } else {
    throw new HttpError(400, "BAD_REQUEST", "不認得的操作");
  }
  detail.purged = purged;
  await db.insert(adminLog).values({ adminId: admin.id, action: ACTION_LABEL[action], target: `artist:${r.artistSlug}`, detail: JSON.stringify(detail) });
  const [after] = await db.select({ status: artistPhotos.status }).from(artistPhotos).where(eq(artistPhotos.id, id));
  return { id, status: after?.status ?? "", purged };
}
