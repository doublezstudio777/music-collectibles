import { requireConsented } from "@/lib/server/terms";
import { json, readBody } from "@/lib/server/auth";
import { createCollection } from "@/lib/server/collections";
import { handle } from "@/lib/server/trade";

/**
 * 發布全家福合集（2026-10-01）：{ photoIds, story, customTitle?, tags: [{ key, photo?, x?, y? }] } → { n }。
 * 照片先 POST /api/uploads（跟一般收藏同一套：浮水印、查證碼、每日上限），合集純展示，不收出售狀態
 */
export async function POST(req: Request) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  return handle(async () => json({ n: await createCollection(s.user, body) }, 201));
}
