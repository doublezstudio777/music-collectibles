import { fail, json } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { validSlug } from "@/lib/server/me";

/**
 * 一位藝人的全部系列＞品項＞版本（2026-10-01 合集標記、批次發文用）：?artist=slug → { artist, series: PickSeries[] }。
 * 內容公開，跟系列頁看得到的一樣；不含辨識細節（目錄號、條碼）
 */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("artist") ?? "";
  if (!validSlug(slug)) return fail(400, "BAD_REQUEST", "參數不對");
  const c = await getCatalog();
  const a = c.getArtist(slug);
  if (!a) return fail(404, "NOT_FOUND", "找不到這位藝人");
  return json({ artist: { slug: a.slug, name: a.name }, series: c.pickSeriesOf(slug) });
}
