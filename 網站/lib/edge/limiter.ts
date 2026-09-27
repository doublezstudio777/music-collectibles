// 防整站爬取：同一個 IP 短時間大量請求就暫時擋下（2026-09-28）。
//
// 計數只放在 Worker 記憶體（isolate），完全不寫 D1：限流每個請求都要算，寫 D1 會拖慢又耗寫入額度。
// 代價是每個 isolate 各算各的；同一個 IP 的請求通常落在同一個資料中心的少數幾個 isolate，
// 所以實際門檻是「下面的數字 × 那幾個 isolate」，擋得住連續狂抓，擋不住刻意分散到很多資料中心的爬蟲。
//
// 兩個計數，任一個超過就擋 60 秒（固定視窗）：
// - 頁面：整頁或站內換頁（RSC，不含預先載入）各算 1。10 秒 30、5 分鐘 300（平均每秒 1 頁）。
//   爬蟲主要是這種請求；一般人看一頁要幾秒，連續快點 1 秒 1 頁 10 秒也才 10
// - 全部（加權）：頁面 1、API 0.5、預先載入 0.1、照片 0.05、靜態檔 0。10 秒 150、5 分鐘 1500。
//   擋大量打 API 或照片；一般人看一頁（1 頁＋2 支 API＋約 20 個預先載入＋24 張縮圖）約 5.2
// 一般人 2 秒看一頁連看 5 分鐘：頁面 150、全部約 780，都碰不到。

export const LIMITS = {
  page: { shortMax: 30, longMax: 300 },
  all: { shortMax: 150, longMax: 1500 },
  shortMs: 10_000,
  longMs: 300_000,
  blockMs: 60_000,
};
const MAX_KEYS = 20_000;

type S = { s: number; sAt: number; l: number; lAt: number; until: number };
const table = new Map<string, S>();
const blocked = new Map<string, number>();

const STATIC = /\.(?:js|mjs|css|map|woff2?|ttf|otf|ico|png|svg|jpg|jpeg|gif|webp|avif|txt|xml|json)$/i;

export function weight(req: Request, url: URL): number {
  const p = url.pathname;
  if (p.startsWith("/img/")) return 0.05;
  if (p.startsWith("/assets/") || p.startsWith("/_next/") || p.startsWith("/_vinext/") || STATIC.test(p)) return 0;
  if (p.startsWith("/api/")) return 0.5;
  const h = req.headers;
  if (h.get("next-router-prefetch") || h.get("next-router-segment-prefetch") || h.get("sec-purpose")?.includes("prefetch") || h.get("purpose") === "prefetch") {
    return 0.1;
  }
  return 1;
}

function bump(key: string, w: number, max: { shortMax: number; longMax: number }, now: number): boolean {
  let e = table.get(key);
  if (!e) {
    if (table.size >= MAX_KEYS) {
      // Map 依插入順序：丟掉最舊的一成
      let n = MAX_KEYS / 10;
      for (const k of table.keys()) {
        table.delete(k);
        if (--n <= 0) break;
      }
    }
    e = { s: 0, sAt: now, l: 0, lAt: now, until: 0 };
    table.set(key, e);
  }
  if (now - e.sAt >= LIMITS.shortMs) {
    e.s = 0;
    e.sAt = now;
  }
  if (now - e.lAt >= LIMITS.longMs) {
    e.l = 0;
    e.lAt = now;
  }
  e.s += w;
  e.l += w;
  return e.s > max.shortMax || e.l > max.longMax;
}

/** 記一次；回傳還要擋幾秒（0＝放行）。w＝weight() 的權重 */
export function take(ip: string, w: number, now = Date.now()): number {
  const until = blocked.get(ip) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  if (w <= 0) return 0;
  const over = (w >= 1 && bump(`p:${ip}`, 1, LIMITS.page, now)) || bump(`a:${ip}`, w, LIMITS.all, now);
  if (!over) return 0;
  blocked.set(ip, now + LIMITS.blockMs);
  table.delete(`p:${ip}`);
  table.delete(`a:${ip}`);
  if (blocked.size > MAX_KEYS) blocked.clear();
  return Math.ceil(LIMITS.blockMs / 1000);
}

export function tooMany(retry: number) {
  return new Response("請求太頻繁，已暫時擋下。請稍等一分鐘再繼續瀏覽。\n", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(retry),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
