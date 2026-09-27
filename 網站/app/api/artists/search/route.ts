import { json } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { norm } from "@/lib/data";

/**
 * 炫收藏表單「找不到？打字搜尋」用：查全部藝人（含尚未有收藏、尚未強制顯示的那 200 多位），
 * 跟 /api/artists（藝人目錄，只回前台看得到的）分開，因為表單要能選到還沒有人分享過的藝人。
 * ?q= 空字串一律回空陣列，不把整份名單吐回去。
 */
export async function GET(req: Request) {
  const q = norm(new URL(req.url).searchParams.get("q") ?? "");
  if (!q) return json({ artists: [] });
  const c = await getCatalog();
  const artists = c.artists
    .filter((a) => norm(a.name).includes(q) || a.aliases.some((x) => norm(x).includes(q)))
    .slice(0, 20)
    .map((a) => ({ slug: a.slug, name: a.name, aliases: a.aliases, kind: a.kind, gender: a.gender ?? null, region: a.region ?? null }));
  return json({ artists });
}
