import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { mergeArtists } from "@/lib/server/duplicates";

/** 合併：{ keep, lose }。keep 保留，lose 併過去後軟刪除＋轉址 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await mergeArtists(s.user, b.keep, b.lose)));
}
