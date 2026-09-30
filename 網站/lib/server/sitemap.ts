// 動態 sitemap（2026-10-01 SEO）：只列可收錄的頁（lib/server/seo.ts 的判斷），跟頁面 noindex 用同一套規則，
// 不會出現「sitemap 列了、頁面卻 noindex」。每次請求現算（目錄在 Worker 記憶體有快取），新增內容下一次讀就出現。
// 分檔：/sitemap.xml 是索引，底下 /sitemaps/pages.xml、artists-1.xml、series-1.xml、shares-1.xml…，每檔最多 CHUNK 筆。

import { getCatalog } from "@/lib/server/content";
import { artistIndex, overrideOf, seoContext, seriesIndex, shareIndex } from "@/lib/server/seo";
import { artistHref, seriesHref, shareHref } from "@/lib/data";
import { CANONICAL_ORIGIN } from "@/lib/seo";

/** 協定上限 5 萬筆；壓在 5000 筆，一檔的 CPU 與大小都小 */
export const CHUNK = 5000;
export type Entry = { loc: string; lastmod?: string };
export type Group = "pages" | "artists" | "series" | "shares";

const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);

export async function sitemapGroups(): Promise<Record<Group, Entry[]>> {
  const [c, ctx] = await Promise.all([getCatalog(), seoContext()]);
  const pages: Entry[] = [
    ...(overrideOf(ctx, "page:home").noindex ? [] : [{ loc: "/" }]),
    { loc: "/artists" },
    ...(overrideOf(ctx, "page:about").noindex ? [] : [{ loc: "/about" }]),
    { loc: "/guide" },
    { loc: "/privacy" },
    { loc: "/terms" },
  ];
  const artists = c.artists
    .filter((a) => c.artistVisible(a) && artistIndex(c, ctx, a).index)
    .map((a) => ({ loc: artistHref(a.slug), lastmod: day(a.lastEdit.date) }));
  const series = c.seriesList.filter((w) => seriesIndex(c, ctx, w).index).map((w) => ({ loc: seriesHref(w), lastmod: day(w.lastEdit.date) }));
  const shares = c.shares
    .filter((s) => shareIndex(c, s).index)
    .map((s) => ({ loc: shareHref(s.n), lastmod: day(s.editedAt) ?? day(new Date(s.order).toISOString()) }));
  return { pages, artists, series, shares };
}

/** 索引裡的檔名：pages.xml、artists-1.xml… */
export function fileNames(g: Record<Group, Entry[]>) {
  const out: string[] = ["pages.xml"];
  for (const k of ["artists", "series", "shares"] as const) {
    const n = Math.ceil(g[k].length / CHUNK);
    for (let i = 1; i <= n; i++) out.push(`${k}-${i}.xml`);
  }
  return out;
}

export function entriesOf(g: Record<Group, Entry[]>, file: string): Entry[] | null {
  if (file === "pages.xml") return g.pages;
  const m = file.match(/^(artists|series|shares)-(\d{1,4})\.xml$/);
  if (!m) return null;
  const list = g[m[1] as Group];
  const i = Number(m[2]);
  if (i < 1 || (i - 1) * CHUNK >= list.length) return null;
  return list.slice((i - 1) * CHUNK, i * CHUNK);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 網址裡的中文 slug 要編碼（sitemap 只收 ASCII 網址） */
const loc = (path: string) => esc(`${CANONICAL_ORIGIN}${encodeURI(path)}`);

export const urlsetXml = (list: Entry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${list
    .map((e) => `<url><loc>${loc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
    .join("\n")}\n</urlset>\n`;

export const indexXml = (files: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files
    .map((f) => `<sitemap><loc>${esc(`${CANONICAL_ORIGIN}/sitemaps/${f}`)}</loc></sitemap>`)
    .join("\n")}\n</sitemapindex>\n`;

export const xmlResponse = (body: string) =>
  new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
