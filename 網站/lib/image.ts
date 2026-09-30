// 瀏覽器端先壓縮再上傳：主圖長邊約 1600px、縮圖長邊 480px，轉 WebP（瀏覽器不支援 WebP 編碼時退回 JPEG）。
// 伺服器端（lib/server/photos.ts）會再看檔頭格式與大小，這裡只是省流量與 R2 容量。
// 收藏照片（2026-09-29）：主圖、縮圖燒進浮水印，另外附一份沒燒的原圖（存 R2 不公開位置，改站名時重燒用），
// 燒法在 lib/watermark-burn.ts。申訴證據不對外，不燒也不附原圖。

import { api } from "@/lib/account";
import { watermarkMark } from "@/lib/data";
import { drawOgImage } from "@/lib/og-image";
import { encode, loadImage, MAIN_EDGE, prepareShareImage, THUMB_EDGE } from "@/lib/watermark-burn";

export { MAIN_EDGE, THUMB_EDGE };

const extOf = (b: Blob) => (b.type === "image/webp" ? "webp" : "jpg");

export type Uploaded = { id: string; url: string; thumbUrl: string; ogUrl?: string; code?: string };

/** 不燒浮水印的壓縮（藝人照片投稿、意見回饋附件用） */
export async function prepareImage(file: File) {
  const img = await loadImage(file);
  let main = await encode(img, MAIN_EDGE, 0.82);
  if (main.size > 1_400_000) main = await encode(img, MAIN_EDGE, 0.6);
  const thumb = await encode(img, THUMB_EDGE, 0.75);
  return { main, thumb, preview: URL.createObjectURL(thumb), img };
}

/** 申訴證據：壓縮後原樣上傳（只給本人與管理員看，不燒浮水印） */
export async function uploadImage(file: File, purpose: "appeal") {
  const { main, thumb } = await prepareImage(file);
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("image", main, `photo.${extOf(main)}`);
  form.append("thumb", thumb, `thumb.${extOf(thumb)}`);
  return api<Uploaded>("/api/uploads", { body: form });
}

/**
 * 收藏照片（多張，2026-09-28；浮水印燒進檔案，2026-09-29）：主圖、縮圖燒好 `© @帳號 · 站名 #查證碼`＋中間斜字，原圖另送。
 * 查證碼先跟伺服器拿（/api/uploads/code），燒好再連同照片送回去，伺服器確認是發給這個人的才收。
 * 分享預覽圖只替封面畫（uploadCoverOg）。沒有帳號名就不上傳（燒不出浮水印）。
 */
export async function uploadSharePhoto(file: File, handle: string) {
  if (!handle) throw new Error("handle");
  const c = await api<{ code: string }>("/api/uploads/code", { method: "POST" });
  if (!c.ok) return c;
  const code = c.data.code;
  const { orig, main, thumb } = await prepareShareImage(file, watermarkMark(handle, code));
  const form = new FormData();
  form.append("purpose", "share");
  form.append("code", code);
  form.append("image", main, `photo.${extOf(main)}`);
  form.append("thumb", thumb, `thumb.${extOf(thumb)}`);
  form.append("orig", orig, `orig.${extOf(orig)}`);
  return api<Uploaded>("/api/uploads", { body: form });
}

/**
 * 封面的分享預覽圖。新選的照片用本機檔案畫、燒浮水印（查證碼用這張照片上傳時拿到的那組）；
 * 已經上傳過的抓主圖（作者本人有登入，拿得到 1600px），主圖已經燒過浮水印，預覽圖就不再疊一層。
 */
export async function uploadCoverOg(photoId: string, source: File | string, handle: string, code = "") {
  const fromServer = typeof source === "string";
  if (!fromServer && !code) throw new Error("code");
  const blob = fromServer ? await fetch(source, { credentials: "same-origin" }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error("fetch")))) : source;
  const img = await loadImage(blob);
  const og = await drawOgImage(img, fromServer ? null : watermarkMark(handle, code));
  const form = new FormData();
  form.append("photoId", photoId);
  form.append("og", og, "og.jpg");
  return api<{ ogUrl: string }>("/api/uploads/og", { body: form });
}

/**
 * 大頭貼（2026-09-28）：縮成 256×256，轉 WebP（不支援時 JPEG）。伺服器只檢查格式與寬高。
 * 2026-09-30 加裁切視窗：選檔後使用者自己拖曳、縮放，確定後用 cropAvatar 從原圖取那一塊正方形；
 * prepareAvatar（從中間裁）留給沒有裁切視窗的呼叫端。原圖不上傳
 */
export const AVATAR_EDGE = 256;
export async function cropAvatar(img: CanvasImageSource, sx: number, sy: number, side: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  const webp = await toBlob("image/webp", 0.85);
  if (webp && webp.type === "image/webp") return webp;
  const jpg = await toBlob("image/jpeg", 0.85);
  if (!jpg) throw new Error("encode");
  return jpg;
}

export async function prepareAvatar(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const side = Math.min(img.width, img.height);
  return cropAvatar(img, Math.round((img.width - side) / 2), Math.round((img.height - side) / 2), side);
}
