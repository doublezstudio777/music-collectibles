import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { clearFollows, setFollow, validSlug } from "@/lib/server/me";

/** { artist: 藝人 slug, on: true|false } */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  if (!validSlug(body.artist) || typeof body.on !== "boolean") return fail(400, "BAD_REQUEST", "參數不對");
  await setFollow(s.user.id, body.artist, body.on);
  return json({ artist: body.artist, on: body.on });
}

/** 清掉全部追蹤 */
export async function DELETE(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  await clearFollows(s.user.id);
  return json({ ok: true });
}
