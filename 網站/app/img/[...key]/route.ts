import { env } from "cloudflare:workers";

/**
 * 照片透過網站路徑提供：/img/p/{id}.webp。
 * 檔名是隨機 id、內容不會改，所以快取一年＋immutable，讓 Cloudflare 快取接住大部分讀取（不算 R2 讀取次數）。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const k = key.join("/");
  if (!/^p\/[A-Za-z0-9_-]+\.(webp|jpg)$/.test(k) || !env.PHOTOS) return new Response("Not found", { status: 404 });
  const obj = await env.PHOTOS.get(k);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? (k.endsWith(".webp") ? "image/webp" : "image/jpeg"),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: obj.httpEtag,
    },
  });
}
