// 瀏覽器端先壓縮再上傳：主圖長邊約 1600px、縮圖長邊 480px，轉 WebP（瀏覽器不支援 WebP 編碼時退回 JPEG）。
// 伺服器端（lib/server/photos.ts）會再看檔頭格式與大小，這裡只是省流量與 R2 容量。

import { api } from "@/lib/account";
import { watermarkText } from "@/lib/data";
import { drawOgImage } from "@/lib/og-image";

export const MAIN_EDGE = 1600;
export const THUMB_EDGE = 480;

async function loadImage(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(img: HTMLImageElement, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error("encode"));
        if (b.type === "image/webp") return resolve(b);
        // 不支援 WebP 編碼（舊 Safari）：改 JPEG
        canvas.toBlob((j) => (j ? resolve(j) : reject(new Error("encode"))), "image/jpeg", quality);
      },
      "image/webp",
      quality,
    ),
  );
}

export async function prepareImage(file: File) {
  const img = await loadImage(file);
  let main = await encode(img, MAIN_EDGE, 0.82);
  // 還是太大（極少見）再降一次品質
  if (main.size > 1_400_000) main = await encode(img, MAIN_EDGE, 0.6);
  const thumb = await encode(img, THUMB_EDGE, 0.75);
  return { main, thumb, preview: URL.createObjectURL(thumb), img };
}

export type Uploaded = { id: string; url: string; thumbUrl: string; ogUrl?: string };

/**
 * 壓縮＋上傳一張；失敗回傳錯誤碼與訊息（STORAGE_FULL／UPLOAD_PAUSED 要顯示「上傳暫停」）。
 * purpose＝"share" 且帶 handle 時，另外在瀏覽器畫一張 1200×630 JPEG 分享預覽圖（og:image 用，
 * 浮水印直接燒進去），跟主圖、縮圖一起送；伺服器端不處理影像，只是多存一個檔。
 * 申訴證據（appeal）不對外，不產生預覽圖。
 */
export async function uploadImage(file: File, purpose: "share" | "appeal", handle?: string) {
  const { main, thumb, img } = await prepareImage(file);
  const ext = main.type === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("image", main, `photo.${ext}`);
  form.append("thumb", thumb, `thumb.${thumb.type === "image/webp" ? "webp" : "jpg"}`);
  if (purpose === "share" && handle) {
    try {
      const og = await drawOgImage(img, handle, watermarkText(handle));
      form.append("og", og, "og.jpg");
    } catch {
      // 畫失敗（極少見，例如字型沒載到）就不附；伺服器沒收到 og 檔就不存，og:image 退回縮圖
    }
  }
  return api<Uploaded>("/api/uploads", { body: form });
}
