import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { artistExists, setDismiss, validSlug } from "@/lib/server/me";

/** 熱門藝人「不感興趣」：{ artist, on }。on=true 之後不再推薦這位 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  if (!validSlug(body.artist) || typeof body.on !== "boolean") return fail(400, "BAD_REQUEST", "參數不對");
  if (body.on && !(await artistExists(body.artist))) return fail(404, "NOT_FOUND", "找不到這位藝人");
  await setDismiss(s.user.id, body.artist, body.on);
  return json({ artist: body.artist, on: body.on });
}
