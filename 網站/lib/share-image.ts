// 預覽圖（og:image）用的 canvas 小工具：字型載入、照片裁切、浮水印（lib/og-image.ts 用）。
// 2026-09-28 拿掉「下載分享圖」，原本畫限時動態／貼文圖的程式一併刪除，只留預覽圖共用的這三支。
// - 等字型載入完成才畫：document.fonts.load 帶實際要畫的字，Google Fonts 的中文字才會把需要的分段載進來

const SANS = '"Inter", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

/** 要畫的字全部先載好；回傳 false＝字型沒載到 */
export async function ensureFonts(text: string, mono: string) {
  if (!document.fonts) return false;
  const specs = [
    [`700 64px "Noto Sans TC"`, text],
    [`500 40px "Noto Sans TC"`, text],
    [`400 32px "Noto Sans TC"`, text],
    [`700 64px "Inter"`, text],
    [`500 40px "Inter"`, text],
    [`400 32px "Inter"`, text],
    [`500 28px "IBM Plex Mono"`, mono],
  ] as const;
  const load = () => Promise.all(specs.map(([f, t]) => document.fonts.load(f, t).catch(() => [])));
  await load();
  await document.fonts.ready;
  // 第一次可能還在下載分段檔，確認不過再等一輪
  if (!specs.every(([f, t]) => document.fonts.check(f, t))) {
    await new Promise((r) => setTimeout(r, 600));
    await load();
    await document.fonts.ready;
  }
  return specs.every(([f, t]) => document.fonts.check(f, t));
}

/** 照片 cover 裁切進框（分享圖、og 預覽圖共用） */
export function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** 浮水印：右下角白字加深色陰影，中間再疊一個斜的淡字（跟網頁上的 CSS 浮水印同一個樣子；分享圖、og 預覽圖共用） */
export function drawWatermark(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.font = `500 34px ${SANS}`;
  ctx.textAlign = "right";
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fillText(text, x + w - 24, y + h - 24);
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-Math.PI / 9);
  ctx.textAlign = "center";
  ctx.font = `700 64px ${SANS}`;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.fillText(text, 0, 20);
  ctx.restore();
}
