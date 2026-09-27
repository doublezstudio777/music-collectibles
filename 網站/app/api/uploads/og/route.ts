import { fail, json, requireUser } from "@/lib/server/auth";
import { attachOgImage } from "@/lib/server/photos";

/** multipart：photoId、og（1200×630 JPEG，浮水印已燒進去）。只給封面用：發文前、或編輯時換了封面 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "BAD_REQUEST", "要用 multipart 上傳");
  }
  const og = form.get("og");
  const r = await attachOgImage(new URL(req.url).origin, s.user.id, String(form.get("photoId") ?? ""), og && typeof og !== "string" ? (og as File) : null);
  if (!r.ok) return fail(r.error.status, r.error.code, r.error.message);
  return json({ ogUrl: r.ogUrl }, 201);
}
