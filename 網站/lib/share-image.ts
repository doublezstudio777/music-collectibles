// 下載分享圖（給 IG 用）：瀏覽器端 canvas 畫，完全不經過伺服器。
// - 照片用頁面上已經載入的那張 <img>（同源 /img/，不會汙染 canvas，也不會多讀一次 R2）
// - 等字型載入完成才畫：document.fonts.load 帶實際要畫的字，Google Fonts 的中文字才會把需要的分段載進來；
//   載完再用 document.fonts.check 確認，確認不過就不畫，避免畫出系統預設字
// - 色彩照 DESIGN.md：白底黑字、灰字 #5C5C5C，橘只出現在網址前那一小塊

import { SITE_NAME, SITE_TITLE, watermarkText, type ShareParts } from "@/lib/data";

export type ShareImageKind = "story" | "post";
export const SHARE_IMAGE_SIZE: Record<ShareImageKind, { w: number; h: number; label: string }> = {
  story: { w: 1080, h: 1920, label: "限時動態" },
  post: { w: 1080, h: 1350, label: "貼文" },
};

export type ShareImageInput = {
  parts: ShareParts;
  /** 沒連到系列時，第二行用這則的標題 */
  what: string;
  kind: string;
  /** 其他周邊的補充（沒連到系列時當第二行） */
  kindNote?: string;
  author: string;
  /** 發文者帳號：照片上畫浮水印 @帳號 · 站名（檔案本身沒有浮水印，分享圖是另外畫的一張） */
  handle?: string;
  url: string;
  photo: HTMLImageElement | null;
};

const SANS = '"Inter", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
// 中文（封面色塊上的「黑膠」）Plex Mono 沒有字，接 Noto Sans TC，不掉到系統等寬字
const MONO = '"IBM Plex Mono", "Noto Sans TC", "SFMono-Regular", Menlo, monospace';
const C = { bg: "#FFFFFF", text: "#111111", muted: "#5C5C5C", line: "#DCDCDC", ph: "#CFCFCF", phFg: "#4A4A4A", orange: "#FF6A00" };

/** 要畫的字全部先載好；回傳 false＝字型沒載到，不畫 */
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

/** 中文逐字斷、英數整個字斷；超過 maxLines 最後一行加刪節號 */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const tokens = text.match(/[A-Za-z0-9'’.\-/:#]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let cur = "";
  const push = () => {
    lines.push(cur.trimEnd());
    cur = "";
  };
  for (const tk of tokens) {
    if (!cur && /^\s+$/.test(tk)) continue;
    if (ctx.measureText(cur + tk).width <= maxW) {
      cur += tk;
      continue;
    }
    if (cur) push();
    if (/^\s+$/.test(tk)) continue;
    // 單一個英數字串就比整行寬：逐字切
    if (ctx.measureText(tk).width > maxW) {
      for (const ch of Array.from(tk)) {
        if (ctx.measureText(cur + ch).width > maxW) push();
        cur += ch;
      }
    } else cur = tk;
  }
  if (cur) push();
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last && ctx.measureText(last + "…").width > maxW) last = Array.from(last).slice(0, -1).join("");
  out[maxLines - 1] = last.trimEnd() + "…";
  return out;
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

export function lines(input: ShareImageInput) {
  const { parts } = input;
  const artist = parts.artist || input.author;
  // 沒連到系列：第二行是物件（其他周邊的補充優先），第三行是類型；標題本身是「藝人 類型」，不再重複
  const second = parts.series ? [parts.series, parts.item].filter(Boolean).join("・") : input.kindNote || input.kind;
  const third = parts.series ? parts.version : input.kindNote ? input.kind : "";
  return { artist, second, third };
}

export async function drawShareImage(input: ShareImageInput, kind: ShareImageKind): Promise<Blob> {
  const { w: W, h: H } = SHARE_IMAGE_SIZE[kind];
  const story = kind === "story";
  const { artist, second, third } = lines(input);
  const byline = `${input.author} 的收藏`;
  const brand = SITE_TITLE;
  const mark = input.handle ? watermarkText(input.handle) : "";
  const urlText = input.url.replace(/^https?:\/\//, "");

  const ok = await ensureFonts([artist, second, third, byline, brand, SITE_NAME, mark, input.kind].join(""), urlText + "…");
  if (!ok) throw new Error("fonts");

  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  const pad = 72;
  const inner = W - pad * 2;

  // 字標
  ctx.fillStyle = C.text;
  ctx.font = `700 ${story ? 44 : 40}px ${SANS}`;
  ctx.fillText(SITE_NAME, pad, pad + (story ? 44 : 38));

  // 照片
  const py = story ? 180 : 144;
  const ph = story ? inner : Math.round((inner * 3) / 4);
  if (input.photo && input.photo.naturalWidth) {
    drawCover(ctx, input.photo, pad, py, inner, ph);
    if (mark) drawWatermark(ctx, mark, pad, py, inner, ph);
  } else {
    ctx.fillStyle = C.ph;
    ctx.fillRect(pad, py, inner, ph);
    ctx.fillStyle = C.phFg;
    ctx.font = `500 40px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(input.kind, pad + inner - 32, py + ph - 32);
    ctx.textAlign = "left";
  }

  // 文字區
  let y = py + ph + (story ? 96 : 76);
  const block = (text: string, font: string, size: number, lh: number, max: number, color: string, gap: number) => {
    if (!text) return;
    ctx.font = `${font} ${size}px ${SANS}`;
    ctx.fillStyle = color;
    for (const l of wrap(ctx, text, inner, max)) {
      ctx.fillText(l, pad, y);
      y += lh;
    }
    y += gap;
  };
  block(artist, "700", story ? 64 : 56, story ? 80 : 70, story ? 2 : 1, C.text, story ? 12 : 6);
  block(second, "500", story ? 40 : 36, story ? 56 : 50, story ? 2 : 1, C.text, story ? 8 : 4);
  block(third, "400", story ? 36 : 32, story ? 50 : 44, story ? 2 : 1, C.muted, 0);

  // 分隔線＋發文者（y 是上一行的基線＋行距，線畫在上一行字的下方、下一行字的上方）
  const ruleY = y - (story ? 14 : 12);
  ctx.fillStyle = C.line;
  ctx.fillRect(pad, ruleY, inner, 2);
  y = ruleY + (story ? 32 + 36 : 30 + 30);
  block(byline, "400", story ? 32 : 30, story ? 44 : 40, 1, C.muted, 0);

  // 底部：站名＋網址（橘只在網址前那一小塊）
  const bottom = H - pad;
  ctx.fillStyle = C.text;
  ctx.font = `500 ${story ? 30 : 28}px ${SANS}`;
  ctx.fillText(brand, pad, bottom - (story ? 52 : 46));
  ctx.fillStyle = C.orange;
  ctx.fillRect(pad, bottom - 22, 20, 20);
  ctx.fillStyle = C.text;
  ctx.font = `500 28px ${MONO}`;
  ctx.fillText(wrap(ctx, urlText, inner - 36, 1)[0] ?? "", pad + 36, bottom);

  return new Promise((resolve, reject) =>
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", 0.92),
  );
}
