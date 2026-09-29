import { requireAdmin } from "@/lib/server/auth";
import { feedbackPhoto } from "@/lib/server/feedback";

/** 意見回饋的附件照片：?id=回饋 id&size=thumb｜full，只給管理員 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const u = new URL(req.url);
  const obj = await feedbackPhoto(Number(u.searchParams.get("id")), u.searchParams.get("size") ?? "full");
  if (!obj) return new Response("Not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  return new Response(await obj.arrayBuffer(), {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
