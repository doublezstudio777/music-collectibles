// Google Analytics 4（2026-10-01）：資源 properties/556941544，網頁串流 G-LFTFKWVM5C。
// - 只在正式網域 lemibox.com 載入（本機、預覽、其他網域一律不載入，track 也什麼都不做）
// - 自己送 page_view（站內換頁也算）；網址參數名稱像 token／code／key／email 的先拿掉，會員個人頁與私訊的標題換成通用字，
//   不送 Email、暱稱、訊息內容等任何個資
// - 事件：sign_up、login、share_publish（kind：一般／合集／批次）、dm_send、wishlist_add（type：版本／收藏）、offer_make（kind：出價／我要買）
// - 關掉 Google 信號與廣告個人化（不做再行銷、不跨裝置連結）
// 隱私權政策「交給誰處理」「Cookie」兩段有揭露（1.1 版）；Cookie 同意橫幅先不做，記在 00_現況.md 律師確認清單

export const GA_ID = "G-LFTFKWVM5C";
export const GA_HOST = "lemibox.com";

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    gtag?: Gtag;
    dataLayer?: unknown[];
  }
}

export const gaEnabled = () => typeof window !== "undefined" && window.location.hostname === GA_HOST;

const SECRET_PARAM = /token|code|key|secret|session|pass|e-?mail|mail|sig|auth|reset|verify|otp|invite/i;

/** 網址去掉敏感參數與錨點，回傳 { location, path } */
export function cleanUrl(href: string) {
  const u = new URL(href);
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.delete(k);
  u.hash = "";
  return { location: u.toString(), path: u.pathname + (u.search ? u.search : "") };
}

/** 頁面標題可能帶暱稱（個人頁）或對方名字（私訊），換成通用字 */
export function cleanTitle(path: string, title: string) {
  if (/^\/u\//.test(path)) return "會員個人頁";
  if (/^\/messages/.test(path)) return "私訊";
  if (/^\/me\//.test(path)) return "我的頁面";
  return title;
}

export function track(name: string, params: Record<string, string | number> = {}) {
  if (!gaEnabled() || !window.gtag) return;
  try {
    window.gtag("event", name, params);
  } catch {
    /* 統計失敗不影響使用 */
  }
}
