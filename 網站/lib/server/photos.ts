// 照片上傳（R2）。本機是 Miniflare 模擬的 bucket，雲端 0 個。
//
// 零花費第一道防線：R2 累計位元組記在 D1 counters.r2_bytes，上傳前用一條條件式 UPDATE
// 「先佔額度」（value + n <= 上限才加），同時上傳也不會一起超過；佔不到就拒絕。
// 刪照片時（之後）要把 bytes 扣回來。

import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { photos, settings } from "@/db/schema";
import { randomToken } from "@/lib/server/crypto";
import { hit } from "@/lib/server/services";

/** 總容量上限 8 GB（R2 免費 10 GB，留 2 GB 緩衝） */
export const STORAGE_LIMIT = 8 * 1024 ** 3;
/** 主圖（長邊約 1600px WebP）單檔上限 */
export const MAX_MAIN_BYTES = 1_500_000;
/** 縮圖（長邊約 480px）單檔上限 */
export const MAX_THUMB_BYTES = 200_000;
/** 每人每天最多上傳幾張（主圖＋縮圖算一張） */
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

/**
 * 收一張照片（主圖＋縮圖），存 R2、記 photos 列（還沒掛到任何一則收藏）。
 * 檢查順序：暫停 → 格式 → 大小 → 每日上限 → 總容量。
 */
export async function acceptUpload(
  ownerId: string,
  purpose: "share" | "appeal",
  main: File | null,
  thumb: File | null,
): Promise<{ ok: true; id: string; url: string; thumbUrl: string } | { ok: false; error: UploadError }> {
  const bad = (status: number, code: string, message: string) => ({ ok: false as const, error: { status, code, message } });
  if (await isPaused()) return bad(503, "UPLOAD_PAUSED", "上傳暫停");
  if (!main || !thumb) return bad(400, "BAD_REQUEST", "缺照片檔");
  if (main.size > MAX_MAIN_BYTES || thumb.size > MAX_THUMB_BYTES) return bad(413, "TOO_LARGE", "照片太大，換一張再試");
  const mainBytes = new Uint8Array(await main.arrayBuffer());
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
  const type = sniff(mainBytes);
  const tType = sniff(thumbBytes);
  if (!type || !tType) return bad(415, "BAD_FORMAT", "只收 WebP 或 JPEG 照片");
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hit(`upload:${ownerId}:${day}`, DAILY_UPLOADS, 86400))) {
    return bad(429, "DAILY_LIMIT", `今天已經上傳 ${DAILY_UPLOADS} 張，明天再來`);
  }
  const bytes = mainBytes.length + thumbBytes.length;
  if (!(await reserveBytes(bytes))) return bad(507, "STORAGE_FULL", "上傳暫停");

  const id = randomToken(12);
  const ext = type === "image/webp" ? "webp" : "jpg";
  const tExt = tType === "image/webp" ? "webp" : "jpg";
  const key = `p/${id}.${ext}`;
  const thumbKey = `p/${id}_t.${tExt}`;
  const bucket = env.PHOTOS;
  if (!bucket) {
    await releaseBytes(bytes);
    return bad(503, "NO_STORAGE", "照片儲存還沒設定");
  }
  try {
    await bucket.put(key, mainBytes, { httpMetadata: { contentType: type } });
    await bucket.put(thumbKey, thumbBytes, { httpMetadata: { contentType: tType } });
  } catch {
    await releaseBytes(bytes);
    return bad(502, "STORAGE_ERROR", "照片存不進去，再試一次");
  }
  const { width, height } = dimensions(mainBytes, type);
  await getDb().insert(photos).values({ id, ownerId, purpose, r2Key: key, thumbKey, contentType: type, bytes, width, height });
  return { ok: true, id, url: `/img/${key}`, thumbUrl: `/img/${thumbKey}` };
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
