// Worker 進入點（2026-09-28 CPU 修正）：公開頁面整頁快取，包在 vinext 的處理程式外面。
//
// 為什麼：免費方案每個請求 CPU 上限 10ms，React 伺服器渲染一頁就要 10～60ms。公開頁面不因人而異
// （讚數等是總數，登入者自己的狀態由前端從 /api/me 疊上去），同一個內容版本只要渲染一次。
//
// 規則：
// - 只快取 GET、白名單路徑（首頁、藝人目錄、藝人頁與底下、單則頁、標籤頁、登入頁、隱私權政策、使用條款、關於頁、
//   新手指南、收藏榮譽榜、意見回饋表單（2026-09-29）），200 與 404。榮譽榜不掛內容版本，最多舊 5 分鐘（TTL），資料本來就每日才更新
// - 快取鍵含 content_version.v：公開內容一有寫入（含隱藏、下架；按讚、我有、想要 2026-09-28 起不算，數字改走 /api/counts），資料庫觸發器就把 v 加 1，
//   下一個請求換新鍵，舊副本再也不會被送出去。跟 /img/ 一樣是「先問 D1 再查快取」，不靠清快取，
//   所以每個資料中心都立刻生效（caches.default.delete 只清單一資料中心）
// - 快取鍵含部署版本：新部署不會拿到舊版 HTML（舊 chunk 檔名）
// - 快取鍵含 RSC 相關標頭：站內換頁（RSC 請求）跟整頁 HTML 分開存
// - 回應有 Set-Cookie 不存；版本號讀不到（-1）一律不快取
// - 快取最多存 5 分鐘（頁面上「3 小時前」這類相對時間最多舊 5 分鐘）
//
// - 整頁快取的頁面（HIT、MISS 都是）帶 x-yz-build（部署版本前 8 碼，本機是開機亂數）：部署後判斷回應來自新版本還是還沒退場的舊版本（2026-09-28 部署快取批次）
//
// 2026-09-28 防盜版批次，另外兩件事也在這裡做（都在查快取之前，都不碰 D1）：
// - IP 限流（lib/edge/limiter.ts）：記憶體計數，超過回 429
// - 連線國家：把 Cloudflare 判定的 request.cf.country 放進 x-yz-country 表頭給 API 用（交易只限台灣）。
//   用戶端自己送來的 x-yz-country 一律丟掉。本機（LOCAL_TEST=1）可用 x-yz-test-country 表頭或
//   yz_test_country cookie 模擬，沒帶就用 GEO_DEFAULT（預設 TW）。頁面本身不因國家而異，整頁快取不受影響
import handler from "vinext/server/fetch-handler";
import { take, tooMany, weight } from "./lib/edge/limiter";
import { cleanupOldRecords, cleanupOrphans } from "./lib/server/cleanup";
import { notifyAdmin } from "./lib/server/notify";
import { hit } from "./lib/server/services";
import { runSpotifyDraw } from "./lib/server/spotify-draw";
import { runAutofill } from "./lib/server/autofill";
import { startReleaseScan } from "./lib/server/release-scan";
import { recomputeScores } from "./lib/server/scores";

type Env = { DB: D1Database; CF_VERSION_METADATA?: { id: string }; LOCAL_TEST?: string; GEO_DEFAULT?: string };
type Handler = { fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
const app = handler as unknown as Handler;

const CACHEABLE = /^\/(?:$|artists$|login$|privacy$|terms$|about$|guide$|ranking$|feedback$|artist\/[^/]+(?:\/.*)?$|share\/\d+$|tag\/[^/]+$)/;
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
// 整頁快取鍵只留這些查詢參數（2026-10-02 總檢 S7）：首頁 state／sort／page、藝人目錄 g／type／r、藝人頁與系列頁 edit、
// 登入頁 next／mode、意見回饋 type。其他參數一律丟掉，`/?隨便=1` 不會變成一次新的完整渲染
const KEEP_PARAMS = new Set(["state", "sort", "page", "g", "type", "r", "edit", "next", "mode"]);

// 安全標頭（2026-10-02 總檢 S6）：所有回應都帶。CSP 放行 Spotify 嵌入（frame）、GA4（script、connect）、Turnstile（script、frame）、
// Google Fonts（style、font）；React／vinext 的 hydration 用內嵌 script，所以 script-src 要 'unsafe-inline'。
// frame-ancestors 'none'＝不能被別的網站用 iframe 嵌入（後台、設定頁）；HSTS 一年含子網域（www 也是我們的）
const CSP = [
  "default-src 'self'",
  // static.cloudflareinsights.com／cloudflareinsights.com：Cloudflare 在 zone 層自動注入的 Web Analytics beacon（2026-10-02 部署煙霧測試抓到被 CSP 擋）
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://challenges.cloudflare.com https://cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com https://open.spotify.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const SECURITY_HEADERS: [string, string][] = [
  ["Content-Security-Policy", CSP],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"],
];
/** 回應補上安全標頭（原本已經有的不蓋，例如 /img/ 的 nosniff）；https 才加 HSTS */
function secure(res: Response, https: boolean) {
  const out = new Response(res.body, res);
  for (const [k, v] of SECURITY_HEADERS) if (!out.headers.has(k)) out.headers.set(k, v);
  if (https) out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return out;
}
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
  const k = new URL(url.pathname, url.origin);
  for (const name of [...url.searchParams.keys()].sort()) if (KEEP_PARAMS.has(name)) k.searchParams.set(name, url.searchParams.get(name) ?? "");
  k.searchParams.set("__yz", `${v}.${deploy}.${h}`);
  return new Request(k.toString(), { method: "GET" });
}

/** 連線國家（ISO 兩碼大寫）；判定不出來回 "XX" */
function country(req: Request, env: Env): string {
  if (env.LOCAL_TEST === "1") {
    const fake = req.headers.get("x-yz-test-country") ?? req.headers.get("cookie")?.match(/(?:^|;\s*)yz_test_country=([A-Za-z]{2})/)?.[1];
    return (fake ?? env.GEO_DEFAULT ?? "TW").toUpperCase();
  }
  const cf = (req as Request & { cf?: { country?: string } }).cf;
  const c = cf?.country;
  return typeof c === "string" && /^[A-Z0-9]{2}$/i.test(c) ? c.toUpperCase() : "XX";
}

/** 限流的鍵：正式站用 cf-connecting-ip；本機只算帶 x-yz-rl-test 的請求（驗收用，值當假 IP），其餘不限 */
function limitKey(req: Request, env: Env): string | null {
  if (env.LOCAL_TEST === "1") return req.headers.get("x-yz-rl-test");
  return req.headers.get("cf-connecting-ip");
}

// 正式網域（2026-09-30 定案 lemibox.com）：www 綁在同一個 Worker（Custom Domain），這裡一律 301 到 apex。
// http 也一律 301 到 https apex（Custom Domain 預設 http 照樣回 200，zone 的 Always Use HTTPS 沒開、金鑰也沒有改 zone 設定的權限）。
// 帳號的 API 金鑰沒有 Redirect Rules 權限，改在 Worker 做；不碰 D1，不吃限流。舊的 workers.dev 網址 2026-10-01 關閉（workers_dev=false），不轉址
const WWW_HOST = "www.lemibox.com";
const APEX_HOST = "lemibox.com";
const APEX = "https://lemibox.com";

const worker = {
  async fetch(raw: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(raw.url);
    if (url.hostname === WWW_HOST || (url.hostname === APEX_HOST && url.protocol === "http:")) return Response.redirect(APEX + url.pathname + url.search, 301);
    return secure(await inner(raw, env, ctx, url), url.protocol === "https:");
  },

};

async function inner(raw: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
    const ip = limitKey(raw, env);
    if (ip) {
      const wait = take(ip, weight(raw, url));
      if (wait > 0) return tooMany(wait);
    }
    const headers = new Headers(raw.headers);
    headers.delete("x-yz-test-country");
    headers.set("x-yz-country", country(raw, env));
    // 沒帶 User-Agent 的請求 vinext 會把 metadata 串流到 <body>，整頁快取又不分 User-Agent：補一個，讓大家都拿 <head> 版（next.config.ts）
    if (!headers.get("user-agent")) headers.set("user-agent", "lemibox-no-ua");
    const req = new Request(raw, { headers });
    if (req.method !== "GET" || !CACHEABLE.test(url.pathname) || url.pathname === "/share/new") {
      return app.fetch(req, env, ctx);
    }
    const v = await version(env);
    if (v < 0) return app.fetch(req, env, ctx);
    const cache = (caches as unknown as { default: Cache }).default;
    const deploy = env.CF_VERSION_METADATA?.id ?? bootId();
    const build = deploy.slice(0, 8);
    const key = await cacheKey(req, url, v, deploy);
    const cached = await cache.match(key);
    if (cached) {
      const res = new Response(cached.body, cached);
      res.headers.set("x-yz-cache", "HIT");
      res.headers.set("x-yz-build", build);
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
    out.headers.set("x-yz-build", build);
    return out;
}

/** 排程失敗：記 console，另外寄一封給管理員（同一個工作一天最多一封；2026-10-02 總檢 S11） */
async function cronFailed(job: string, e: unknown) {
  console.error(`[樂迷藏排程] ${job}失敗`, e);
  try {
    if (await hit(`cron-alert:${job}`, 1, 86400)) {
      await notifyAdmin(`排程「${job}」失敗`, [`排程工作「${job}」執行失敗，錯誤：`, String(e instanceof Error ? (e.stack ?? e.message) : e).slice(0, 1500), "", "同一個工作一天只寄一封，之後的失敗只記在 Workers 的記錄裡（wrangler tail 或儀表板）。"]);
    }
  } catch (err) {
    console.error("[樂迷藏排程] 寄警示信失敗", err);
  }
}

const scheduledWorker = {
  // 每天一次（wrangler.production.jsonc 的 triggers.crons，台灣時間 02:00）：
  // - 國家與活動紀錄、限流計數保存 90 天，超過就清掉（lib/server/cleanup.ts）
  // - 彙總會員分數、等級、稱號（lib/server/scores.ts；SQL 在 D1 裡跑，不吃 Worker CPU）
  // 兩件事各自獨立，失敗只記 console，不影響另一件與下一次排程。
  // - Spotify 自動抽歌（2026-09-30）：另一條 `*/5 18-20 * * *`，每 5 分鐘抽一批（lib/server/spotify-draw.ts）
  // - 發布時自動補資料（2026-09-30）：`*/10 * * * *` 接手 waitUntil 沒跑完的工作（lib/server/autofill.ts），沒工作時只查一次 D1
  // - 每月補新作品（2026-10-01）：每天 02:00 那次看這個月開過沒，沒有就開一輪；查詢在 `*/10` 沒工作時分批跑（lib/server/release-scan.ts）
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "*/10 * * * *") {
      ctx.waitUntil(
        runAutofill({ ms: 120_000, maxCalls: 45, scan: true })
          .then((r) => {
            if (r.done) console.log("[樂迷藏排程] 自動補資料", JSON.stringify(r));
          })
          .catch((e) => cronFailed("自動補資料", e)),
      );
      return;
    }
    if (event.cron !== "0 18 * * *") {
      ctx.waitUntil(
        runSpotifyDraw({ now: event.scheduledTime })
          .then((r) => {
            if (r.drawn || r.errors.length || r.bumped) console.log("[樂迷藏排程] Spotify 抽歌", JSON.stringify(r));
          })
          .catch((e) => cronFailed("Spotify 抽歌", e)),
      );
      return;
    }
    ctx.waitUntil(cleanupOldRecords().catch((e) => cronFailed("清理過期紀錄", e)));
    // 沒掛上收藏超過 24 小時的照片（2026-10-02 總檢 S2）
    ctx.waitUntil(
      cleanupOrphans(APEX)
        .then((r) => {
          if (r.deleted) console.log("[樂迷藏排程] 清理未掛照片", JSON.stringify({ deleted: r.deleted, bytesReleased: r.bytesReleased }));
        })
        .catch((e) => cronFailed("清理未掛照片", e)),
    );
    // 每月補新作品（2026-10-01）：這個月還沒開過就開一輪，實際查詢由 */10 的排程分批接手（lib/server/release-scan.ts）
    ctx.waitUntil(
      startReleaseScan({ trigger: "cron", now: event.scheduledTime }).catch((e) => cronFailed("每月補新作品", e)),
    );
    ctx.waitUntil(recomputeScores().catch((e) => cronFailed("彙總分數", e)));
  },
};

const site = { ...worker, ...scheduledWorker };
export default site;
