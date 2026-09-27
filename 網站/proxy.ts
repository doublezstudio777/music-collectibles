import { NextResponse, type NextRequest } from "next/server";
import { indexingAllowed } from "@/lib/server/guard";
import { redirectTarget } from "@/lib/server/redirects";
import { getCatalog } from "@/lib/server/content";

/**
 * 全站回應加 X-Robots-Tag（不給搜尋引擎收錄，開關是 ALLOW_INDEXING）。
 * 頁面另外有 <meta name="robots" content="noindex">（layout.tsx）。robots.txt 不擋爬取，理由見 app/robots.txt/route.ts。
 *
 * 藝人識別碼轉址（2026-09-28）：/artist/{舊}/...（含系列、歷史）→ 301 到 /artist/{新}/...，查詢字串照帶；
 * 只有 /artist/ 開頭才查 D1（一筆主鍵查詢）。
 *
 * 藝人名標籤（2026-09-28）：/tag/{藝人名稱或別名} → 301 到 /artist/{slug}；藝人被隱藏、沒有公開頁就照舊顯示標籤頁。
 * 目錄用 isolate 記憶體快取那份（跟頁面同一份），不另外查 D1。
 */
export async function proxy(req: NextRequest) {
  const m = req.nextUrl.pathname.match(/^\/artist\/([^/]+)(\/.*)?$/);
  if (m) {
    let slug = m[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* 解不開就照原字查 */
    }
    const to = await redirectTarget(slug).catch(() => null);
    if (to) {
      const url = req.nextUrl.clone();
      url.pathname = `/artist/${to}${m[2] ?? ""}`;
      const res = NextResponse.redirect(url, 301);
      if (!indexingAllowed()) res.headers.set("X-Robots-Tag", "noindex");
      return res;
    }
  }
  const t = req.nextUrl.pathname.match(/^\/tag\/([^/]+)$/);
  if (t) {
    let tag = t[1];
    try {
      tag = decodeURIComponent(tag);
    } catch {
      /* 解不開就照原字查 */
    }
    const a = await getCatalog()
      .then((c) => c.artistForTag(tag))
      .catch(() => undefined);
    if (a) {
      const url = req.nextUrl.clone();
      url.pathname = `/artist/${a.slug}`;
      url.search = "";
      const res = NextResponse.redirect(url, 301);
      if (!indexingAllowed()) res.headers.set("X-Robots-Tag", "noindex");
      return res;
    }
  }
  const res = NextResponse.next();
  if (!indexingAllowed()) res.headers.set("X-Robots-Tag", "noindex");
  return res;
}
