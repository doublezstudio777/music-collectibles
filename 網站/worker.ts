// Worker 進入點（2026-09-28 CPU 修正）：公開頁面整頁快取，包在 vinext 的處理程式外面。
//
// 為什麼：免費方案每個請求 CPU 上限 10ms，React 伺服器渲染一頁就要 10～60ms。公開頁面不因人而異
// （讚數等是總數，登入者自己的狀態由前端從 /api/me 疊上去），同一個內容版本只要渲染一次。
//
// 規則：
// - 只快取 GET、白名單路徑（首頁、藝人目錄、藝人頁與底下、單則頁、標籤頁、登入頁），200 與 404
// - 快取鍵含 content_version.v：公開內容一有寫入（含隱藏、下架、按讚），資料庫觸發器就把 v 加 1，
//   下一個請求換新鍵，舊副本再也不會被送出去。跟 /img/ 一樣是「先問 D1 再查快取」，不靠清快取，
//   所以每個資料中心都立刻生效（caches.default.delete 只清單一資料中心）
// - 快取鍵含部署版本：新部署不會拿到舊版 HTML（舊 chunk 檔名）
// - 快取鍵含 RSC 相關標頭：站內換頁（RSC 請求）跟整頁 HTML 分開存
// - 回應有 Set-Cookie 不存；版本號讀不到（-1）一律不快取
// - 快取最多存 5 分鐘（頁面上「3 小時前」這類相對時間最多舊 5 分鐘）
import handler from "vinext/server/fetch-handler";

type Env = { DB: D1Database; CF_VERSION_METADATA?: { id: string } };
type Handler = { fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
const app = handler as unknown as Handler;

const CACHEABLE = /^\/(?:$|artists$|login$|artist\/[^/]+(?:\/.*)?$|share\/\d+$|tag\/[^/]+$)/;
const VARY = [
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
  "x-vinext-interception-context",
  "x-vinext-mounted-slots",
  "x-vinext-rsc-render-mode",
  "x-vinext-rsc-compatibility-id",
];
const TTL = 300;
// 本機沒有部署版本號：每次起伺服器換一個，重新建置後不會拿到舊 HTML
// （Worker 全域範圍不能產生亂數，第一次用到才產生）
let boot = "";
const bootId = () => (boot ||= crypto.randomUUID());

// 存進快取時 Cache-Control 要改成可快取、Vary 要拿掉（鍵已經含那些標頭），原值另存，送出時還原
const keep = (h: Headers, name: string) => {
  const v = h.get(name);
  h.delete(name);
  if (v !== null) h.set(`x-yz-orig-${name}`, v);
};
const restore = (h: Headers, name: string) => {
  const v = h.get(`x-yz-orig-${name}`);
  h.delete(`x-yz-orig-${name}`);
  h.delete(name);
  if (v !== null) h.set(name, v);
};

async function version(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare("SELECT v FROM content_version WHERE id = 1").first<{ v: number }>();
    return row ? row.v : -1;
  } catch {
    return -1;
  }
}

async function cacheKey(req: Request, url: URL, v: number, deploy: string) {
  const vary = VARY.map((h) => req.headers.get(h) ?? "").join("\n");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(vary)));
  const h = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  const k = new URL(url.pathname + url.search, url.origin);
  k.searchParams.set("__yz", `${v}.${deploy}.${h}`);
  return new Request(k.toString(), { method: "GET" });
}

const worker = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "GET" || !CACHEABLE.test(url.pathname) || url.pathname === "/share/new") {
      return app.fetch(req, env, ctx);
    }
    const v = await version(env);
    if (v < 0) return app.fetch(req, env, ctx);
    const cache = (caches as unknown as { default: Cache }).default;
    const key = await cacheKey(req, url, v, env.CF_VERSION_METADATA?.id ?? bootId());
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("x-yz-cache", "HIT");
      res.headers.delete("age");
      restore(res.headers, "cache-control");
      restore(res.headers, "vary");
      return res;
    }
    const res = await app.fetch(req, env, ctx);
    if ((res.status !== 200 && res.status !== 404) || res.headers.has("set-cookie")) return res;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("text/html") && !type.startsWith("text/x-component")) return res;
    const [a, b] = res.body ? res.body.tee() : [null, null];
    const stored = new Response(b, res);
    keep(stored.headers, "cache-control");
    keep(stored.headers, "vary");
    stored.headers.set("Cache-Control", `public, max-age=${TTL}`);
    ctx.waitUntil(cache.put(key, stored).catch(() => {}));
    const out = new Response(a, res);
    out.headers.set("x-yz-cache", "MISS");
    return out;
  },
};

export default worker;
