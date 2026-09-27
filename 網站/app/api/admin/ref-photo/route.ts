import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { setRefPhoto } from "@/lib/server/photos";

/** 管理員：炫收藏的照片標為／取消辨識參考 { share, key, on } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  const r = await setRefPhoto(s.user.id, b.share, b.key, b.on);
  if (!r.ok) return Response.json({ error: { code: "INVALID", message: r.message } }, { status: r.status });
  return json(r);
}
