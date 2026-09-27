// 大頭貼（2026-09-28 法務頁與帳號設定）。
//
// - 瀏覽器端裁成正方形、壓成 256×256 WebP（不支援 WebP 編碼的舊 Safari 退回 JPEG），伺服器不做影像處理，
//   只看檔頭格式、寬高、大小
// - 存 R2 `v/{id}.webp`，photos 表記一列（purpose=avatar，主圖＝縮圖同一個檔），計入 counters.r2_bytes（8GB 上限）
// - 每人每天最多換 5 次（移除不算）
// - 換掉或被移除的舊檔：photos 標 deleted_at、R2 刪檔、容量扣回、清這個資料中心的快取；
//   /img/ 先查 D1，照片標刪除後其他資料中心的快取副本也不會再被送出去
// - users.avatar_key 有內容版本觸發器：換大頭貼後整頁快取自動換新
// - 可以被檢舉（reports 表，target＝avatar:{照片 id}），管理員在審核頁或會員頁移除

import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, photos, users } from "@/db/schema";
import { randomToken } from "@/lib/server/crypto";
import { hit } from "@/lib/server/services";
import { dimensions, isPaused, purgePhotoCache, releaseBytes, reserveBytes, sniff } from "@/lib/server/photos";
import { HttpError } from "@/lib/server/trade";
import type { User } from "@/lib/server/auth";

export const AVATAR_EDGE = 256;
export const AVATAR_MAX_BYTES = 100_000;
export const AVATAR_DAILY = 5;

/** 刪掉一張大頭貼的檔案與容量（不動 users.avatar_key）。回傳清掉快取幾個 */
async function dropAvatarFile(origin: string, key: string) {
  const db = getDb();
  const [p] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.r2Key, key), eq(photos.purpose, "avatar"), isNull(photos.deletedAt)));
  if (!p) return 0;
  await db.update(photos).set({ deletedAt: new Date().toISOString() }).where(eq(photos.id, p.id));
  await env.PHOTOS?.delete(key).catch(() => undefined);
  await releaseBytes(p.bytes);
  return purgePhotoCache(origin, [key]);
}

export async function uploadAvatar(u: User, file: File | null, origin: string) {
  if (await isPaused()) throw new HttpError(503, "UPLOAD_PAUSED", "上傳暫停");
  if (!file) throw new HttpError(400, "BAD_REQUEST", "缺照片檔");
  if (file.size > AVATAR_MAX_BYTES) throw new HttpError(413, "TOO_LARGE", "照片太大，換一張再試");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) throw new HttpError(415, "BAD_FORMAT", "只收 WebP 或 JPEG 照片");
  const { width, height } = dimensions(bytes, type);
  if (width !== AVATAR_EDGE || height !== AVATAR_EDGE) throw new HttpError(400, "BAD_SIZE", `大頭貼要是 ${AVATAR_EDGE}×${AVATAR_EDGE}`);
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hit(`avatar:${u.id}:${day}`, AVATAR_DAILY, 86400))) {
    throw new HttpError(429, "DAILY_LIMIT", `大頭貼一天最多換 ${AVATAR_DAILY} 次，明天再來`);
  }
  if (!(await reserveBytes(bytes.length))) throw new HttpError(507, "STORAGE_FULL", "上傳暫停");
  const bucket = env.PHOTOS;
  const id = randomToken(12);
  const key = `v/${id}.${type === "image/webp" ? "webp" : "jpg"}`;
  if (!bucket) {
    await releaseBytes(bytes.length);
    throw new HttpError(503, "NO_STORAGE", "照片儲存還沒設定");
  }
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  } catch {
    await releaseBytes(bytes.length);
    throw new HttpError(502, "STORAGE_ERROR", "照片存不進去，再試一次");
  }
  const db = getDb();
  await db.insert(photos).values({ id, ownerId: u.id, purpose: "avatar", r2Key: key, thumbKey: key, contentType: type, bytes: bytes.length, width, height });
  await db.update(users).set({ avatarKey: key, updatedAt: new Date().toISOString() }).where(eq(users.id, u.id));
  const old = u.avatarKey;
  const purged = old ? await dropAvatarFile(origin, old) : 0;
  return { key, url: `/img/${key}`, replaced: old ?? null, purged };
}

/** 本人移除，或管理員移除（by 有值＝管理員，寫操作紀錄） */
export async function removeAvatar(target: User, origin: string, by?: User, note = "") {
  const key = target.avatarKey;
  if (!key) throw new HttpError(409, "NO_AVATAR", "沒有大頭貼");
  await getDb().update(users).set({ avatarKey: null, updatedAt: new Date().toISOString() }).where(eq(users.id, target.id));
  const purged = await dropAvatarFile(origin, key);
  if (by) {
    await getDb()
      .insert(adminLog)
      .values({ adminId: by.id, action: "移除大頭貼", target: `user:${target.handle}`, detail: JSON.stringify({ key, note }) });
  }
  return { removed: key, purged };
}

/** 檢舉用：avatar:{照片 id} 這張大頭貼還在用、不是自己的 */
export async function avatarReportable(photoId: string, reporterId: string) {
  const [p] = await getDb()
    .select({ owner: photos.ownerId, key: photos.r2Key, deleted: photos.deletedAt, current: users.avatarKey })
    .from(photos)
    .innerJoin(users, eq(users.id, photos.ownerId))
    .where(and(eq(photos.id, photoId), eq(photos.purpose, "avatar")));
  if (!p || p.deleted || p.current !== p.key) return "gone" as const;
  if (p.owner === reporterId) return "self" as const;
  return "ok" as const;
}
