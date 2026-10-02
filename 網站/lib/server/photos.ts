// 照片上傳（R2）。本機是 Miniflare 模擬的 bucket，雲端 0 個。
//
// 零花費第一道防線：R2 累計位元組記在 D1 counters.r2_bytes，上傳前用一條條件式 UPDATE
// 「先佔額度」（value + n <= 上限才加），同時上傳也不會一起超過；佔不到就拒絕。
// 刪照片時（之後）要把 bytes 扣回來。

import { env } from "cloudflare:workers";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, photos, settings } from "@/db/schema";
import { randomToken } from "@/lib/server/crypto";
import { hit, taiwanDay } from "@/lib/server/services";
import { claimVerifyCode, releaseVerifyCode } from "@/lib/server/verify";
import { VERIFY_CODE_RE } from "@/lib/data";

/** 總容量上限 8 GB（R2 免費 10 GB，留 2 GB 緩衝） */
export const STORAGE_LIMIT = 8 * 1024 ** 3;
/** 主圖（長邊約 1600px WebP）單檔上限 */
export const MAX_MAIN_BYTES = 1_500_000;
/** 縮圖（長邊約 480px）單檔上限 */
export const MAX_THUMB_BYTES = 200_000;
/** 分享預覽圖（1200×630 JPEG，og:image 用）單檔上限 */
export const MAX_OG_BYTES = 400_000;
/** 每人每天最多上傳幾張（主圖＋縮圖算一張；一則多張時每張各算一張，分享預覽圖不算） */
export const DAILY_UPLOADS = 30;

export type ImageType = "image/webp" | "image/jpeg";

/** 看檔頭判斷格式，不信任瀏覽器給的 Content-Type */
export function sniff(b: Uint8Array): ImageType | null {
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/**
 * 檔案結構檢查（2026-10-02 總檢 L5）：檔頭對了還不夠，整個檔要是一張完整的圖、後面不能夾別的東西、不能帶 EXIF。
 * - JPEG：從 SOI 逐段走到 EOI，EOI 後面不能再有資料；APP1 Exif 段一律擋（瀏覽器端 canvas 重新編碼本來就不會有 EXIF，
 *   帶 EXIF＝沒走網站表單，可能含拍攝位置）
 * - WebP：RIFF 長度要等於檔案長度減 8，逐塊走到底；EXIF、XMP 塊一律擋
 * 回傳錯誤訊息；沒問題回 null
 */
export function imageProblem(b: Uint8Array, type: ImageType): string | null {
  const broken = "照片檔案不完整或夾帶其他內容，重新整理後再上傳";
  const exif = "照片帶有 EXIF 資訊（可能含拍攝位置），請用網站的上傳表單重新上傳";
  try {
    if (type === "image/jpeg") {
      let i = 2;
      let sos = false;
      while (i < b.length) {
        if (b[i] !== 0xff) return broken;
        const m = b[i + 1];
        if (m === 0xff) {
          i++;
          continue;
        }
        if (m === 0xd9) return i + 2 === b.length && sos ? null : broken;
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
          i += 2;
          continue;
        }
        if (i + 4 > b.length) return broken;
        const len = (b[i + 2] << 8) | b[i + 3];
        if (len < 2 || i + 2 + len > b.length) return broken;
        if (m === 0xe1 && len >= 8 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return exif;
        i += 2 + len;
        if (m === 0xda) {
          // 掃過壓縮資料：直到遇到不是 FF00、不是 RSTn 的標記
          sos = true;
          while (i < b.length) {
            if (b[i] === 0xff && i + 1 < b.length && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7) && b[i + 1] !== 0xff) break;
            i++;
          }
        }
      }
      return broken;
    }
    const riff = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
    if (riff + 8 !== b.length) return broken;
    let i = 12;
    while (i + 8 <= b.length) {
      const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
      const size = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      if (id === "EXIF" || id === "XMP ") return exif;
      i += 8 + size + (size & 1);
    }
    return i === b.length ? null : broken;
  } catch {
    return broken;
  }
}

/** 看檔頭＋整個檔案結構（sniff＋imageProblem）；格式不對回 null，結構有問題丟 { error } */
export function checkImage(b: Uint8Array): { type: ImageType } | { error: string } | null {
  const type = sniff(b);
  if (!type) return null;
  const problem = imageProblem(b, type);
  return problem ? { error: problem } : { type };
}

/** 讀寬高：WebP（VP8／VP8L／VP8X）與 JPEG（SOF）。讀不到回 0 */
export function dimensions(b: Uint8Array, type: ImageType): { width: number; height: number } {
  try {
    if (type === "image/webp") {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return { width: 0, height: 0 };
    }
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return { width: 0, height: 0 };
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
  } catch {
    /* 讀不到就 0 */
  }
  return { width: 0, height: 0 };
}

export async function isPaused() {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, "paused"));
  return row?.value === "1";
}

export async function storageUsed() {
  const row = await env.DB!.prepare("SELECT value FROM counters WHERE key = 'r2_bytes'").first<{ value: number }>();
  return row?.value ?? 0;
}

/** 先佔 n 位元組：成功回 true；超過上限回 false（沒有加） */
export async function reserveBytes(n: number) {
  const db = env.DB!;
  await db.prepare("INSERT OR IGNORE INTO counters (key, value) VALUES ('r2_bytes', 0)").run();
  const r = await db
    .prepare("UPDATE counters SET value = value + ?1 WHERE key = 'r2_bytes' AND value + ?1 <= ?2")
    .bind(n, STORAGE_LIMIT)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function releaseBytes(n: number) {
  await env.DB!.prepare("UPDATE counters SET value = MAX(0, value - ?1) WHERE key = 'r2_bytes'").bind(n).run();
}

export type UploadError = { status: number; code: string; message: string };

/** 分享預覽圖只收 JPEG（瀏覽器端固定畫成 JPEG，浮水印已燒進去） */
function sniffJpeg(b: Uint8Array): "image/jpeg" | null {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg" : null;
}

/**
 * 收一張照片（主圖＋縮圖，選配分享預覽圖），存 R2、記 photos 列（還沒掛到任何一則收藏）。
 * 檢查順序：暫停 → 格式 → 大小 → 每日上限 → 總容量。
 * og＝1200×630 JPEG 預覽圖（浮水印已燒進去，og:image 用）；格式不對或沒帶就不存，og:image 退回縮圖，
 * 不當成整筆上傳失敗——這張圖只是加分，不是必要條件。
 * orig＝沒燒浮水印的原圖（2026-09-29）：收藏照片必帶，存 `o/{id}`，/img/ 只開放 p/a/v/r 四個目錄，這個目錄任何網址都拿不到。
 * 主圖、縮圖是瀏覽器燒好浮水印的；伺服器不做影像處理，也驗不出有沒有燒，靠的是只有新版表單送得出 orig。
 * code＝查證碼（2026-09-29）：收藏照片必帶，要是 /api/uploads/code 發給這個人、還沒用過的碼，存進 photos.verify_code。
 */
export async function acceptUpload(
  ownerId: string,
  purpose: "share" | "appeal",
  main: File | null,
  thumb: File | null,
  og: File | null = null,
  orig: File | null = null,
  code = "",
): Promise<{ ok: true; id: string; url: string; thumbUrl: string; ogUrl?: string; code?: string } | { ok: false; error: UploadError }> {
  const bad = (status: number, code: string, message: string) => ({ ok: false as const, error: { status, code, message } });
  if (await isPaused()) return bad(503, "UPLOAD_PAUSED", "上傳暫停");
  if (!main || !thumb) return bad(400, "BAD_REQUEST", "缺照片檔");
  if (main.size > MAX_MAIN_BYTES || thumb.size > MAX_THUMB_BYTES) return bad(413, "TOO_LARGE", "照片太大，換一張再試");
  const mainBytes = new Uint8Array(await main.arrayBuffer());
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
  const mainChk = checkImage(mainBytes);
  const thumbChk = checkImage(thumbBytes);
  if (!mainChk || !thumbChk) return bad(415, "BAD_FORMAT", "只收 WebP 或 JPEG 照片");
  if ("error" in mainChk) return bad(400, "BAD_IMAGE", mainChk.error);
  if ("error" in thumbChk) return bad(400, "BAD_IMAGE", thumbChk.error);
  const type = mainChk.type;
  const tType = thumbChk.type;
  // 原圖：收藏照片必帶（舊版頁面送不出來，請對方重新整理），申訴證據不收
  let origBytes: Uint8Array | null = null;
  let oType: ImageType | null = null;
  if (purpose === "share") {
    if (!orig || orig.size > MAX_MAIN_BYTES || !VERIFY_CODE_RE.test(code)) return bad(400, "RELOAD", "網頁版本太舊，重新整理再上傳");
    origBytes = new Uint8Array(await orig.arrayBuffer());
    const oChk = checkImage(origBytes);
    if (!oChk) return bad(415, "BAD_FORMAT", "只收 WebP 或 JPEG 照片");
    if ("error" in oChk) return bad(400, "BAD_IMAGE", oChk.error);
    oType = oChk.type;
  }
  // og 只在申訴（appeal）以外、格式對、大小對時才收；不合就當沒帶，不擋主圖上傳
  let ogBytes: Uint8Array | null = null;
  if (purpose === "share" && og && og.size > 0 && og.size <= MAX_OG_BYTES) {
    const b = new Uint8Array(await og.arrayBuffer());
    if (sniffJpeg(b) && !imageProblem(b, "image/jpeg")) ogBytes = b;
  }
  const id = randomToken(12);
  // 查證碼先佔：不是發給這個人的、或已經用過的就擋（在扣每日額度、寫 R2、佔容量之前；2026-10-02 總檢 L6 把順序換到額度前面）
  if (purpose === "share" && !(await claimVerifyCode(ownerId, code, id))) return bad(409, "CODE_USED", "上傳失敗，再試一次");
  const day = taiwanDay();
  if (!(await hit(`upload:${ownerId}:${day}`, DAILY_UPLOADS, 86400))) {
    // 額度用完：把剛佔的查證碼還回去，這組碼下次還能用
    if (purpose === "share") await releaseVerifyCode(code, id);
    return bad(429, "DAILY_LIMIT", `今天已經上傳 ${DAILY_UPLOADS} 張，明天再來`);
  }
  const bytes = mainBytes.length + thumbBytes.length + (ogBytes?.length ?? 0) + (origBytes?.length ?? 0);
  if (!(await reserveBytes(bytes))) return bad(507, "STORAGE_FULL", "上傳暫停");

  const ext = type === "image/webp" ? "webp" : "jpg";
  const tExt = tType === "image/webp" ? "webp" : "jpg";
  // 申訴證據放 a/（只給本人與管理員看，/img/ 會檢查身分）；公開照片放 p/
  const dir = purpose === "appeal" ? "a" : "p";
  const key = `${dir}/${id}.${ext}`;
  const thumbKey = `${dir}/${id}_t.${tExt}`;
  const ogKey = ogBytes ? `${dir}/${id}_og.jpg` : null;
  const origKey = origBytes && oType ? `o/${id}.${oType === "image/webp" ? "webp" : "jpg"}` : null;
  const bucket = env.PHOTOS;
  if (!bucket) {
    await releaseBytes(bytes);
    return bad(503, "NO_STORAGE", "照片儲存還沒設定");
  }
  try {
    await bucket.put(key, mainBytes, { httpMetadata: { contentType: type } });
    await bucket.put(thumbKey, thumbBytes, { httpMetadata: { contentType: tType } });
    if (ogKey && ogBytes) await bucket.put(ogKey, ogBytes, { httpMetadata: { contentType: "image/jpeg" } });
    if (origKey && origBytes && oType) await bucket.put(origKey, origBytes, { httpMetadata: { contentType: oType } });
  } catch {
    await bucket.delete([key, thumbKey, ...(ogKey ? [ogKey] : []), ...(origKey ? [origKey] : [])]).catch(() => undefined);
    await releaseBytes(bytes);
    return bad(502, "STORAGE_ERROR", "照片存不進去，再試一次");
  }
  const { width, height } = dimensions(mainBytes, type);
  const verifyCode = purpose === "share" ? code : null;
  await getDb().insert(photos).values({ id, ownerId, purpose, r2Key: key, thumbKey, ogKey, origKey, verifyCode, contentType: type, bytes, width, height });
  return { ok: true, id, url: `/img/${key}`, thumbUrl: `/img/${thumbKey}`, ...(ogKey ? { ogUrl: `/img/${ogKey}` } : {}), ...(verifyCode ? { code: verifyCode } : {}) };
}

/**
 * 清掉上傳超過 24 小時還沒掛到任何收藏的分享照片（2026-10-02 總檢 S2）：R2 檔刪掉、容量扣回、D1 標 deleted_at。
 * 每天排程跑（worker.ts scheduled → cleanup.ts），後台也可以手動跑。申訴證據照片（purpose=appeal）由檢舉、申訴引用，不在這裡清。
 * dryRun＝只列不刪
 */
export async function cleanupOrphanPhotos(origin: string, { hours = 24, dryRun = false, now = Date.now() } = {}) {
  const cutoff = new Date(now - hours * 3600_000).toISOString();
  const rows = await getDb()
    .select()
    .from(photos)
    .where(and(eq(photos.purpose, "share"), isNull(photos.shareNo), isNull(photos.deletedAt), lt(photos.createdAt, cutoff)));
  const list = rows.map((r) => ({ id: r.id, owner: r.ownerId, key: r.r2Key, bytes: r.bytes, createdAt: r.createdAt }));
  if (dryRun || !rows.length) return { photos: list, bytesReleased: 0, deleted: 0 };
  const bytesReleased = await removePhotoFiles(origin, rows);
  return { photos: list, bytesReleased, deleted: rows.length };
}

/** 自己上傳、還沒掛到收藏或申訴的照片 */
export async function unattachedPhotos(ownerId: string, ids: string[], purpose: "share" | "appeal") {
  if (!ids.length) return [];
  const rows = await getDb()
    .select()
    .from(photos)
    .where(and(eq(photos.ownerId, ownerId), eq(photos.purpose, purpose), isNull(photos.shareNo), isNull(photos.deletedAt)));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => Boolean(r));
}

/* ---------- 照片快取（2026-09-28） ----------
 * /img/ 的公開照片由 Worker 自己用 Cache API（caches.default）存，快取鍵是「網站來源＋路徑」，不含查詢字串。
 * 收藏被隱藏或刪除時呼叫 purgePhotoCache 清主圖與縮圖。
 * 注意：caches.default.delete 只清「這次請求落在的那個資料中心」，其他資料中心的副本清不到；
 * 所以真正擋住的是 /img/ 每次先查 D1（guard.ts siteStatus 的 gone），這裡的清除是把本地副本一併丟掉、不佔空間。
 */
export const photoCacheKey = (origin: string, key: string) => new Request(`${origin}/img/${key}`);

const defaultCache = () => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined);

export async function purgePhotoCache(origin: string, keys: string[]) {
  const cache = defaultCache();
  if (!cache) return 0;
  let n = 0;
  for (const k of keys) if (await cache.delete(photoCacheKey(origin, k)).catch(() => false)) n++;
  return n;
}

/** 某則炫收藏的所有照片（主圖＋縮圖）從快取清掉；回傳清掉幾個 */
export async function purgeSharePhotos(origin: string, shareNo: number) {
  const rows = await getDb().select({ a: photos.r2Key, b: photos.thumbKey, c: photos.ogKey }).from(photos).where(eq(photos.shareNo, shareNo));
  return purgePhotoCache(origin, rows.flatMap((r) => [r.a, r.b, ...(r.c ? [r.c] : [])]));
}

export { defaultCache as photoCache };

/* ---------- 多張照片（2026-09-28） ---------- */

/** 每則炫收藏最多幾張 */
export const MAX_SHARE_PHOTOS = 10;

type PhotoRow = typeof photos.$inferSelect;

/**
 * 從 R2 移除照片檔（主圖、縮圖、預覽圖、不公開的原圖），D1 標 deleted_at，容量計數扣回 photos.bytes（已含預覽圖），
 * 並把這幾個網址的快取清掉。回傳扣回多少位元組。
 */
export async function removePhotoFiles(origin: string, rows: PhotoRow[]) {
  if (!rows.length) return 0;
  const at = new Date().toISOString();
  const keys = rows.flatMap((r) => [r.r2Key, r.thumbKey, ...(r.ogKey ? [r.ogKey] : [])]);
  const origKeys = rows.flatMap((r) => (r.origKey ? [r.origKey] : []));
  await env.PHOTOS?.delete([...keys, ...origKeys]).catch(() => undefined);
  const db = env.DB!;
  await db.batch(rows.map((r) => db.prepare("UPDATE photos SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL").bind(at, r.id)));
  const bytes = rows.reduce((a, r) => a + r.bytes, 0);
  await releaseBytes(bytes);
  await purgePhotoCache(origin, keys);
  return bytes;
}

/** 拿掉一張照片的分享預覽圖（封面換掉時舊封面用）：刪 R2 檔、扣回容量、清快取 */
export async function dropOgImage(origin: string, row: PhotoRow) {
  if (!row.ogKey) return;
  const head = await env.PHOTOS?.head(row.ogKey).catch(() => null);
  const size = head?.size ?? 0;
  await env.PHOTOS?.delete(row.ogKey).catch(() => undefined);
  await getDb()
    .update(photos)
    .set({ ogKey: null, bytes: Math.max(0, row.bytes - size) })
    .where(eq(photos.id, row.id));
  await releaseBytes(size);
  await purgePhotoCache(origin, [row.ogKey]);
}

/**
 * 替一張自己的分享照片補上（或換掉）分享預覽圖。只有封面會呼叫：新發的收藏在送出前、
 * 或編輯時換了封面。預覽圖不算每日張數，但算容量。
 */
export async function attachOgImage(origin: string, ownerId: string, photoId: string, og: File | null) {
  const bad = (status: number, code: string, message: string) => ({ ok: false as const, error: { status, code, message } });
  if (!og || og.size === 0 || og.size > MAX_OG_BYTES) return bad(413, "TOO_LARGE", "預覽圖太大");
  const b = new Uint8Array(await og.arrayBuffer());
  if (!sniffJpeg(b)) return bad(415, "BAD_FORMAT", "預覽圖只收 JPEG");
  const [row] = await getDb()
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.ownerId, ownerId), eq(photos.purpose, "share"), isNull(photos.deletedAt)));
  if (!row) return bad(404, "NOT_FOUND", "找不到這張照片");
  if (await isPaused()) return bad(503, "UPLOAD_PAUSED", "上傳暫停");
  if (!(await reserveBytes(b.length))) return bad(507, "STORAGE_FULL", "上傳暫停");
  const bucket = env.PHOTOS;
  if (!bucket) {
    await releaseBytes(b.length);
    return bad(503, "NO_STORAGE", "照片儲存還沒設定");
  }
  // 舊的先拿掉（容量扣回），再放新的；檔名換新，避免別的資料中心還留著舊預覽圖的快取
  if (row.ogKey) await dropOgImage(origin, row);
  const dir = row.r2Key.split("/")[0];
  const ogKey = `${dir}/${row.id}_og${row.ogKey ? `_${randomToken(4)}` : ""}.jpg`;
  try {
    await bucket.put(ogKey, b, { httpMetadata: { contentType: "image/jpeg" } });
  } catch {
    await releaseBytes(b.length);
    return bad(502, "STORAGE_ERROR", "預覽圖存不進去");
  }
  const [fresh] = await getDb().select({ bytes: photos.bytes }).from(photos).where(eq(photos.id, row.id));
  await getDb()
    .update(photos)
    .set({ ogKey, bytes: (fresh?.bytes ?? row.bytes) + b.length })
    .where(eq(photos.id, row.id));
  return { ok: true as const, ogUrl: `/img/${ogKey}` };
}

/** 刪掉自己還沒掛到收藏的分享照片（表單裡按刪除） */
export async function removeUnattached(origin: string, ownerId: string, photoId: string) {
  const rows = await getDb()
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.ownerId, ownerId), eq(photos.purpose, "share"), isNull(photos.shareNo), isNull(photos.deletedAt)));
  await removePhotoFiles(origin, rows);
  return rows.length > 0;
}

/**
 * 管理員把炫收藏的某張照片標為／取消「辨識參考」（2026-09-28，取代會員自勾）。
 * key＝照片的主圖或縮圖檔名（/img/ 後面那段，頁面上本來就公開）。寫一筆操作紀錄。
 * photos 表有 content_version 觸發器，標記後整頁快取自動換版本。
 */
export async function setRefPhoto(adminId: string, rawShare: unknown, rawKey: unknown, on: unknown) {
  const shareNo = Number(rawShare);
  const key = typeof rawKey === "string" ? rawKey.replace(/^.*\/img\//, "") : "";
  if (!Number.isInteger(shareNo) || shareNo <= 0 || !key || typeof on !== "boolean") {
    return { ok: false as const, status: 400, message: "參數不對" };
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.shareNo, shareNo), eq(photos.purpose, "share"), isNull(photos.deletedAt), or(eq(photos.r2Key, key), eq(photos.thumbKey, key))));
  if (!row) return { ok: false as const, status: 404, message: "找不到這張照片" };
  const at = new Date().toISOString();
  if (Boolean(row.refAt) !== on) {
    await db.update(photos).set(on ? { refAt: at, refBy: adminId } : { refAt: null, refBy: null }).where(eq(photos.id, row.id));
  }
  await db.insert(adminLog).values({
    adminId,
    action: on ? "照片標為辨識參考" : "取消照片辨識參考",
    target: `share:${shareNo}`,
    detail: JSON.stringify({ photo: row.id, key: row.thumbKey }),
  });
  return { ok: true as const, on };
}
