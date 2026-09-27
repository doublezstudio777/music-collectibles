import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { adminArtistPhotos, artistPhotoAction, type ArtistPhotoAction } from "@/lib/server/artist-photos";
import { handle } from "@/lib/server/trade";

/** 後台「藝人照片」清單：待審、使用中、最近處理 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json(await adminArtistPhotos(), 200, { "Cache-Control": "no-store" });
}

const ACTIONS: ArtistPhotoAction[] = ["activate", "reject", "delete", "remove"];

/** { id, action: activate｜reject｜delete｜remove, note? }。每個操作寫操作紀錄 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const id = Number(b.id);
  const action = str(b.action) as ArtistPhotoAction;
  if (!Number.isInteger(id) || id <= 0 || !ACTIONS.includes(action)) return fail(400, "BAD_REQUEST", "參數不對");
  return handle(async () => json(await artistPhotoAction(s.user, new URL(req.url).origin, id, action, str(b.note).slice(0, 200))));
}
