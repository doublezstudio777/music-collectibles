// sitemap 分檔（2026-10-01 SEO）：pages.xml、artists-N.xml、series-N.xml、shares-N.xml。規則見 lib/server/sitemap.ts
import { entriesOf, sitemapGroups, urlsetXml, xmlResponse } from "@/lib/server/sitemap";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const list = entriesOf(await sitemapGroups(), (await ctx.params).file);
  if (!list) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return xmlResponse(urlsetXml(list));
}
