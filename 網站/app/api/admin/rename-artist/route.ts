import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { renameArtist } from "@/lib/server/redirects";

/** 改藝人識別碼：{ from, to }。自動寫一筆轉址紀錄，舊網址 301 到新網址 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await renameArtist(s.user, b.from, b.to)));
}
