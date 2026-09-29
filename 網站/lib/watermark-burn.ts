// 收藏照片的浮水印燒進檔案（2026-09-29 方向改變：原本顯示時用 CSS 疊，直接開照片網址就看得到原圖）。
// 全部在瀏覽器 canvas 做，伺服器不做影像處理：
// - 上傳：lib/image.ts 用 prepareShareImage 一次產出「原圖（不公開）＋燒好浮水印的主圖、縮圖」
// - 重燒：scripts/reburn-watermark.py 用 esbuild 把這支打包成 window.YZBurn，在無頭瀏覽器裡跑 burnFromOriginal，
//   跟網站上傳時是同一份程式、同一套字型，改站名時從不公開的原圖重燒全部照片
// 這支只能 import 不碰網站狀態的模組（share-image），重燒腳本才打包得動。

import type { WatermarkMark } from "@/lib/data";
import { drawOgImage } from "@/lib/og-image";
import { drawWatermark, ensureFonts, watermarkScale } from "@/lib/share-image";

export const MAIN_EDGE = 1600;
export const THUMB_EDGE = 480;

export async function loadImage(file: Blob) {
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

/** 縮到長邊 max，mark 有值就燒浮水印；WebP（瀏覽器不支援 WebP 編碼時退回 JPEG） */
export function encode(img: HTMLImageElement, max: number, quality: number, mark: WatermarkMark | null = null): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas"));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (mark) {
    // 畫在照片正中央的正方形裡：網站的卡片與單則頁是正方形框、置中裁切，右下角的字不會被裁掉
    const side = Math.min(canvas.width, canvas.height);
    drawWatermark(ctx, mark, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, watermarkScale(canvas.width, canvas.height));
  }
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

/** 主圖太大（極少見）再降一次品質 */
async function encodeMain(img: HTMLImageElement, mark: WatermarkMark | null) {
  const main = await encode(img, MAIN_EDGE, 0.82, mark);
  return main.size > 1_400_000 ? encode(img, MAIN_EDGE, 0.6, mark) : main;
}

/** 先載網站字型；載不到（網路慢、被擋）照樣燒，字型鏈後面有各平台內建的中文字（微軟正黑體、蘋方） */
const fontsFor = (mark: WatermarkMark) => ensureFonts(mark.corner + mark.center, "").catch(() => false);

/** 上傳收藏照片：原圖（長邊 1600、不燒，只存不公開位置）＋燒了浮水印的主圖與縮圖 */
export async function prepareShareImage(file: Blob, mark: WatermarkMark) {
  if (!mark.corner || !mark.center) throw new Error("mark");
  await fontsFor(mark);
  const img = await loadImage(file);
  const orig = await encodeMain(img, null);
  const main = await encodeMain(img, mark);
  const thumb = await encode(img, THUMB_EDGE, 0.75, mark);
  return { orig, main, thumb, img };
}

/** 重燒：從不公開的原圖產生新的主圖與縮圖（scripts/reburn-watermark.py 用） */
export async function burnFromOriginal(orig: Blob, mark: WatermarkMark) {
  const fonts = await fontsFor(mark);
  const img = await loadImage(orig);
  const main = await encodeMain(img, mark);
  const thumb = await encode(img, THUMB_EDGE, 0.75, mark);
  return { main, thumb, img, fonts };
}

/** 重燒：分享預覽圖（1200×630 JPEG）也從原圖重畫，站名換了這張一起換 */
export const ogFromOriginal = (img: HTMLImageElement, mark: WatermarkMark) => drawOgImage(img, mark);
