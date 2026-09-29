// canvas 小工具：字型載入、照片裁切、浮水印（lib/og-image.ts、lib/watermark-burn.ts 用）。
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

/**
 * 浮水印：右下角白字加深色陰影，中間再疊一個斜的淡字。og 預覽圖與收藏照片（2026-09-29 起燒進檔案）共用。
 * scale：字級倍率。og 預覽圖（1200×630）不帶＝1；收藏照片用 watermarkScale(寬, 高) 依短邊等比放大縮小，
 * 帶了 scale 時另外檢查字寬，窄圖放不下就再縮，不會超出照片。
 */
export function drawWatermark(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, scale?: number) {
  const k = scale ?? 1;
  const fit = (px: number, weight: number, room: number) => {
    ctx.font = `${weight} ${px}px ${SANS}`;
    if (scale === undefined) return;
    const tw = ctx.measureText(text).width;
    if (tw > room) ctx.font = `${weight} ${Math.max(6, (px * room) / tw)}px ${SANS}`;
  };
  ctx.save();
  fit(34 * k, 500, w * 0.8);
  ctx.textAlign = "right";
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 6 * k;
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fillText(text, x + w - 24 * k, y + h - 24 * k);
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-Math.PI / 9);
  ctx.textAlign = "center";
  fit(64 * k, 700, Math.min(w, h) * 0.85);
  ctx.shadowBlur = 0;
  if (scale !== undefined) {
    // 收藏照片：斜字加一圈很淡的深色描邊，白色、淺色的東西（CD 盤面、白底）上面也看得到
    ctx.lineWidth = Math.max(1, 2 * k);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,.16)";
    ctx.strokeText(text, 0, 20 * k);
  }
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.fillText(text, 0, 20 * k);
  ctx.restore();
}

/** 收藏照片的浮水印倍率：以 og 預覽圖的短邊 630px 為 1，照片短邊越長字越大 */
export const watermarkScale = (w: number, h: number) => Math.min(w, h) / 630;
