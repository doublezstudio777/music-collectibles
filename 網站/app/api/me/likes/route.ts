import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { setLike, shareExists, validShareNo } from "@/lib/server/me";

/** { share: 炫收藏流水號, on: true|false } */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  if (!validShareNo(body.share) || typeof body.on !== "boolean") return fail(400, "BAD_REQUEST", "參數不對");
  if (body.on && !(await shareExists(body.share))) return fail(404, "NOT_FOUND", "找不到這則收藏");
  await setLike(s.user.id, body.share, body.on);
  return json({ share: body.share, on: body.on });
}
