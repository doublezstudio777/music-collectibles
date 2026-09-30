// sitemap 索引（2026-10-01 SEO）：列出 /sitemaps/ 底下的分檔。規則見 lib/server/sitemap.ts
import { fileNames, indexXml, sitemapGroups, xmlResponse } from "@/lib/server/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  return xmlResponse(indexXml(fileNames(await sitemapGroups())));
}
