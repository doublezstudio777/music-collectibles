import { json } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { norm } from "@/lib/data";

/**
 * 炫收藏表單「找不到？打字搜尋」用：查全部藝人（含尚未有收藏、尚未強制顯示的那 200 多位），
 * 跟 /api/artists（藝人目錄，只回前台看得到的）分開，因為表單要能選到還沒有人分享過的藝人。
 * ?q= 空字串一律回空陣列，不把整份名單吐回去。
 * ?visible=1（2026-09-30 設定頁「最喜歡的藝人」）：只回前台看得到藝人頁的，因為個人頁的標籤要連得過去。
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = norm(sp.get("q") ?? "");
  const onlyVisible = sp.get("visible") === "1";
  if (!q) return json({ artists: [] });
  const c = await getCatalog();
  // 排序：名稱或別名完全相同 → 開頭相同 → 包含（2026-09-28：同字首的藝人很多時，打完整名字的那位要排得進前 20）
  const rank = (a: { name: string; aliases: string[] }) =>
    Math.min(...[a.name, ...a.aliases].map(norm).map((n) => (n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3)));
  const artists = c.artists
    .filter((a) => norm(a.name).includes(q) || a.aliases.some((x) => norm(x).includes(q)))
    .filter((a) => !onlyVisible || c.artistVisible(a))
    .map((a, i) => ({ a, r: rank(a), i }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a)
    .slice(0, 20)
    .map((a) => ({ slug: a.slug, name: a.name, aliases: a.aliases, kind: a.kind, gender: a.gender ?? null, region: a.region ?? null }));
  return json({ artists });
}
