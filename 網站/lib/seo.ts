// SEO 共用（2026-10-01 SEO 基礎建設）：標題、描述、照片 alt 的組字規則，伺服器與後台預覽共用。
//
// 三層：
// 1. 自動套用：這支組字，lib/server/seo.ts 套到每一頁的 metadata 與結構化資料
// 2. 自動把關：lib/server/seo.ts 判斷哪些頁 noindex（內容太空、被鎖、待確認），條件一變就跟著變
// 3. 後台手動覆寫：/admin/seo 存在 settings 表（key＝seo:…），空白欄位就用這支自動組的
//
// 會員看不到任何 SEO 欄位；canonical 一律 https://lemibox.com（舊網址 workers.dev 已關閉，2026-10-01）。

import { SITE_NAME, SITE_DESC, titleSegments, type ShareParts } from "@/lib/data";

/** 正式網域：canonical、og:url、og:image、sitemap 一律用這個，不照請求的 host 算 */
export const CANONICAL_ORIGIN = "https://lemibox.com";

/** 標題後綴預設（後台「全站 SEO 設定」可改） */
export const DEFAULT_TITLE_SUFFIX = SITE_NAME;
export const DEFAULT_SITE_DESC = SITE_DESC;

/**
 * 搜尋結果顯示寬度，用「全形字」當單位：中日韓字與全形標點算 1，半形英數與空白算 0.5。
 * Google 桌機版標題約 600px、描述約 920px（兩行），換算成 16～18px 的中文大約標題 30 字、描述 80 字。
 * 只用來提醒，不擋存檔
 */
export const TITLE_MAX = 30;
export const DESC_MAX = 80;

export function displayWidth(s: string) {
  let w = 0;
  for (const ch of s) w += /[\u0000-ÿ｡-ﾟ]/.test(ch) ? 0.5 : 1;
  return w;
}

/** 依顯示寬度截斷，超過的補「…」 */
export function clipWidth(s: string, max: number) {
  if (displayWidth(s) <= max) return s;
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = /[\u0000-ÿ｡-ﾟ]/.test(ch) ? 0.5 : 1;
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return `${out.trimEnd()}…`;
}

/** 多行、多空白壓成一行 */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** 描述用的內文：拿掉網址與「資料來源：」這類註記 */
export const plainText = (s: string) => oneLine(s.replace(/https?:\/\/\S+/g, "").replace(/資料來源[:：]\s*/g, ""));

/** 完整標題（搜尋結果看到的）：頁面標題＋後綴。首頁這類 absolute 標題不加 */
export const fullTitle = (title: string, suffix: string, absolute = false) => (absolute || !suffix ? title : `${title}｜${suffix}`);

/** 「藝人《系列》版本 品項」：收藏頁、系列頁共用。沒有系列時退回「藝人 品項」 */
export function releaseLine(p: ShareParts) {
  const segs = titleSegments(p.series, p.item, p.version);
  const rest = p.series ? segs.slice(1).join(" ") : segs.join(" ");
  const head = p.series ? `${p.artist}《${p.series}》` : p.artist;
  return oneLine(p.series ? `${head}${rest}` : [head, rest].filter(Boolean).join(" "));
}

/** 收藏頁標題：「Hyukoh《23》2020 韓國再版 CD｜民生鄰居的收藏」（後綴另外接） */
/** 沒連系列的收藏，標題照發文的字（「MC HotDog・帽子」→「MC HotDog 帽子」，類型用發文者填的細項，不用「其他周邊」） */
const lineOf = (p: ShareParts, what: string) => (p.series ? releaseLine(p) : "") || oneLine(what.replace(/・/g, " "));

export function shareTitle(p: ShareParts, fallbackWhat: string, author: string) {
  const line = lineOf(p, fallbackWhat);
  return `${line}｜${author}的收藏`;
}

/** 收藏頁描述：藝人、專輯、版本、發行年，再接發文內容前 40 字 */
export function shareDescription(p: ShareParts, year: string, story: string, fallback: string) {
  const line = lineOf(p, fallback);
  const y = /^\d{4}/.test(year) && !line.includes(year.slice(0, 4)) ? `，${year.slice(0, 4)}年發行` : "";
  const s = oneLine(story);
  return clipWidth(`${line}${y}。${s ? clipWidth(s, 40) : ""}`.replace(/。$/, ""), DESC_MAX);
}

/**
 * 收藏照片的 alt：「Hyukoh《23》2020 韓國再版 CD，民生鄰居的收藏照片」；多張加第幾張。
 * 發文者自訂的標題也吃（what），藝人名取「跟誰有關」
 */
export function sharePhotoAlt(v: { what: string; about: string[]; author: { name: string }; link?: unknown }, index?: number, total?: number) {
  const who = v.about.join("、");
  const [first, ...rest] = v.what.split("・").map(oneLine);
  // 連到系列的標題是「系列・版本 品項」，組成「藝人《系列》版本 品項」；沒連系列的是「跟誰有關・類型」，照原字
  const what = v.link && rest.length ? `《${first}》${rest.join(" ")}` : oneLine(v.what.replace(/・/g, " "));
  const head = who && !what.includes(who) ? `${who}${v.link && rest.length ? "" : " "}${what}` : what;
  const nth = total && total > 1 && index !== undefined ? `（第 ${index + 1} 張，共 ${total} 張）` : "";
  return `${head}，${v.author.name}的收藏照片${nth}`;
}

/** 覆寫值：後台存的，空字串＝用自動的 */
export type SeoOverride = { title?: string; description?: string; og?: string; noindex?: boolean };
export type SeoSite = { suffix: string; description: string };

/** 後台可覆寫的對象：藝人、系列、首頁、關於頁 */
export type SeoTarget = `artist:${string}` | `series:${string}` | "page:home" | "page:about";
export const SEO_PAGES = { "page:home": "首頁", "page:about": "關於頁" } as const;
export const isSeoTarget = (t: string): t is SeoTarget =>
  t === "page:home" || t === "page:about" || /^artist:[^\s#/]{1,80}$/.test(t) || /^series:[^\s#/]{1,80}\/\d{1,6}$/.test(t);

/**
 * 不收錄的網址（2026-10-01 SEO 第二層）：設定、私訊、搜尋結果、我的頁面（含想要＝願望清單）、登入、後台、API、
 * 會員個人頁、標籤頁（跟藝人頁重複或太空）、榮譽榜、意見回饋、照片查證、發文與編輯、歷史紀錄，以及帶 ?edit 的編輯模式。
 * ALLOW_INDEXING=1 之後這些照樣加 X-Robots-Tag: noindex；沒開放時全站本來就 noindex。
 */
const PRIVATE =
  /^\/(?:(?:admin|api|settings|messages|search|me|login|u|tag|ranking|feedback|verify|takedown)(?:\/|$)|share\/(?:new|\d+\/edit)$|artist\/[^/]+(?:\/\d+)?\/history$)/;
export const isPrivatePath = (pathname: string, search = "") => PRIVATE.test(pathname) || /[?&]edit=/.test(search);

