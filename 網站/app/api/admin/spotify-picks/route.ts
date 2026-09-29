import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { artists } from "@/db/schema";
import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { addPick, adminPicks, removePick, setPickEnabled } from "@/lib/server/spotify-picks";
import { handle } from "@/lib/server/trade";

/** 後台「推薦歌曲」：全部歌曲＋可選的藝人 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const list = await adminPicks();
  const opts = await getDb()
    .select({ slug: artists.slug, name: artists.name })
    .from(artists)
    .where(and(eq(artists.kind, "藝人"), eq(artists.status, "approved"), isNull(artists.deletedAt), isNull(artists.hiddenAt)))
    .orderBy(asc(artists.name));
  return json({ list, artists: opts }, 200, { "Cache-Control": "no-store" });
}

/** { action: add, url, artist }｜{ action: enable｜disable｜delete, id }，寫操作紀錄 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const action = str(b.action);
  return handle(async () => {
    if (action === "add") return json({ pick: await addPick(s.user, b.url, b.artist) });
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) return fail(400, "BAD_REQUEST", "參數不對");
    if (action === "enable" || action === "disable") return json({ pick: await setPickEnabled(s.user, id, action === "enable") });
    if (action === "delete") return json(await removePick(s.user, id));
    return fail(400, "BAD_REQUEST", "參數不對");
  });
}
