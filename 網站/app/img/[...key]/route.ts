import { env } from "cloudflare:workers";
import { isAdmin, tokenFrom, userByToken } from "@/lib/server/auth";
import { countRead, placeholder, siteStatus } from "@/lib/server/guard";
import { photoCache, photoCacheKey } from "@/lib/server/photos";
import { QUOTA_MESSAGE, takeQuota } from "@/lib/server/quota";

/**
 * 照片：/img/p/{id}.webp（公開）、/img/a/{id}.webp（申訴證據，只給本人與管理員）。
 * 檔名是隨機 id、內容不會改。
 *
 * 順序（2026-09-28 改）：先查 D1（暫停、本月讀取數、這張照片還在不在），再查快取，最後才讀 R2。
 * - 照片在資料庫裡已刪、或掛的炫收藏被隱藏／刪除 → 404，並把這個資料中心的快取副本丟掉
 * - 為什麼不能只靠清快取：公開照片的快取是 Worker 自己放進 caches.default 的（workers.dev 回應的
 *   cf-cache-status: HIT 就是這一層），而 caches.default.delete 只清當下那個資料中心。先查 D1 才擋得住所有地方。
 *   這個查詢本來就要做（暫停與讀取數），同一個 batch 多一個 JOIN，不增加 D1 請求數，也不增加 R2 讀取
 * - 快取鍵不含查詢字串：?x=1 這種變化不會繞過快取、多耗 R2 讀取
 * 暫停模式或本月讀取達門檻 → 佔位圖。所有回應都帶 nosniff。
 *
 * 照片分級（2026-09-28 防盜版批次）：
 * - 縮圖（長邊 480px）公開
 * - 大圖（長邊 1600px）要登入，伺服器端檢查（不是只藏前端按鈕）：沒登入 401、每帳號每日上限到了 429。
 *   Cache-Control 改 private，只准瀏覽器自己存，CDN 與共用快取不存；Worker 快取照用（檢查在查快取之前）
 * - 正版辨識的照片（purpose=mark）大小圖都要登入
 * - 浮水印不燒進檔案：檔案是原樣，浮水印在網頁上用 CSS 疊（components/share-card.tsx 的 Watermark）
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const k = key.join("/");
  const notFound = () => new Response("Not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  if (!/^[pa]\/[A-Za-z0-9_-]+\.(webp|jpg)$/.test(k) || !env.PHOTOS) return notFound();

  const { status, photo, gone } = await siteStatus(k);
  // 申訴證據（a/ 開頭，或舊資料裡 purpose=appeal 的）只給上傳的本人與管理員
  const priv = k.startsWith("a/") || photo?.purpose === "appeal";
  const origin = new URL(req.url).origin;
  const cache = !priv ? photoCache() : undefined;
  if (gone) {
    if (cache) await cache.delete(photoCacheKey(origin, k)).catch(() => false);
    return notFound();
  }
  if (priv) {
    const t = tokenFrom(req);
    const s = t ? await userByToken(t.token) : null;
    if (!photo || !s || (s.user.id !== photo.ownerId && !isAdmin(s.user))) return notFound();
  }
  const members = !priv && photo && (photo.isMain || photo.purpose === "mark");
  if (members) {
    const t = tokenFrom(req);
    const s = t ? await userByToken(t.token) : null;
    if (!s) {
      return new Response("登入後查看大圖\n", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    if (s.user.id !== photo.ownerId && !(await takeQuota("photo", s.user.id, status.photoDaily))) {
      return new Response(`${QUOTA_MESSAGE.photo}\n`, {
        status: 429,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Retry-After": "3600" },
      });
    }
  }
  if (status.paused) return placeholder("paused");
  if (status.reads >= status.readLimit) return placeholder("limit");

  if (cache) {
    const hit = await cache.match(photoCacheKey(origin, k));
    if (hit) {
      if (!members) return hit;
      const r = new Response(hit.body, hit);
      r.headers.set("Cache-Control", "private, max-age=86400");
      return r;
    }
  }
  const obj = await env.PHOTOS.get(k);
  if (!obj) return notFound();
  await countRead();
  const body = await obj.arrayBuffer();
  const headers = {
    "Content-Type": obj.httpMetadata?.contentType ?? (k.endsWith(".webp") ? "image/webp" : "image/jpeg"),
    "Cache-Control": priv ? "private, no-store" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: obj.httpEtag,
  };
  if (cache) await cache.put(photoCacheKey(origin, k), new Response(body, { headers })).catch(() => undefined);
  return new Response(body, { headers: members ? { ...headers, "Cache-Control": "private, max-age=86400" } : headers });
}
