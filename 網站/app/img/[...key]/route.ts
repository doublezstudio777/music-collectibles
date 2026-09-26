import { env } from "cloudflare:workers";
import { isAdmin, tokenFrom, userByToken } from "@/lib/server/auth";
import { countRead, placeholder, siteStatus } from "@/lib/server/guard";

/**
 * 照片：/img/p/{id}.webp（公開）、/img/a/{id}.webp（申訴證據，只給本人與管理員）。
 * 檔名是隨機 id、內容不會改。公開照片先查 Cloudflare 快取（Cache API），沒中才讀 R2 並計數（零花費第二道防線）；
 * 暫停模式或本月讀取達門檻 → 佔位圖。所有回應都帶 nosniff。
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const k = key.join("/");
  const notFound = () => new Response("Not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
  if (!/^[pa]\/[A-Za-z0-9_-]+\.(webp|jpg)$/.test(k) || !env.PHOTOS) return notFound();

  const { status, photo } = await siteStatus(k);
  // 申訴證據（a/ 開頭，或舊資料裡 purpose=appeal 的）只給上傳的本人與管理員
  const priv = k.startsWith("a/") || photo?.purpose === "appeal";
  if (priv) {
    const t = tokenFrom(req);
    const s = t ? await userByToken(t.token) : null;
    if (!photo || !s || (s.user.id !== photo.ownerId && !isAdmin(s.user))) return notFound();
  }
  if (status.paused) return placeholder("paused");
  if (status.reads >= status.readLimit) return placeholder("limit");

  const cache = !priv && typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  if (cache) {
    const hit = await cache.match(new Request(req.url));
    if (hit) return hit;
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
  if (cache) await cache.put(new Request(req.url), new Response(body, { headers })).catch(() => undefined);
  return new Response(body, { headers });
}
