// 分享預覽圖（og:image 用）：上傳照片時瀏覽器另外畫一張 1200×630 JPEG，浮水印直接燒進這張。
// - 2026-09-29 起主圖、縮圖也燒浮水印（lib/watermark-burn.ts）；未登入仍拿不到 1600px 大圖
// - mark 是 null＝不燒（來源已經是燒過的主圖，不要疊兩層）；有值＝右下角「© @帳號 · 站名 #查證碼」＋中間「站名 #查證碼」
// - 伺服器端不做任何影像處理（不增加 CPU），全部在瀏覽器 canvas 畫完才上傳
// - 沒有照片就不產生，og:image 退回站方預設圖（lib/server/og.ts 的 OG_DEFAULT）

import type { WatermarkMark } from "@/lib/data";
import { drawCover, drawWatermark, ensureFonts } from "@/lib/share-image";

export const OG_IMAGE_SIZE = { w: 1200, h: 630 };

/** 主圖已經解碼好的 <img>，畫一張燒了浮水印的 1200×630 JPEG */
export async function drawOgImage(img: HTMLImageElement, mark: WatermarkMark | null): Promise<Blob> {
  const { w: W, h: H } = OG_IMAGE_SIZE;
  if (mark) await ensureFonts(mark.corner + mark.center, "").catch(() => false);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("canvas");
  drawCover(ctx, img, 0, 0, W, H);
  if (mark) drawWatermark(ctx, mark, 0, 0, W, H);
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", 0.85));
}
