import { NextResponse, type NextRequest } from "next/server";
import { indexingAllowed } from "@/lib/server/guard";
import { redirectPath } from "@/lib/server/redirects";
import { getCatalog } from "@/lib/server/content";
import { isPrivatePath } from "@/lib/seo";

/**
 * 全站回應加 X-Robots-Tag（不給搜尋引擎收錄，開關是 ALLOW_INDEXING）。
 * 頁面另外有 <meta name="robots" content="noindex">（layout.tsx）。robots.txt 不擋爬取，理由見 app/robots.txt/route.ts。
 *
 * 藝人識別碼轉址（2026-09-28）：/artist/{舊}/...（含系列、歷史）→ 301 到 /artist/{新}/...，查詢字串照帶；
 * 只有 /artist/ 開頭才查 D1（一筆主鍵查詢）。
 * 系列合併轉址（2026-09-28 MusicBrainz 後續）：/artist/{藝人}/{號}/... 被併掉的系列 → 301 到新系列，跟藝人轉址同一個 D1 請求。
 * 301 不進整頁快取（worker.ts 只存 200／404），合併時系列表寫入會讓內容版本加 1，舊的快取副本也不會再被送出。
 *
 * 藝人名標籤（2026-09-28）：/tag/{藝人名稱或別名} → 301 到 /artist/{slug}；藝人被隱藏、沒有公開頁就照舊顯示標籤頁。
 * 目錄用 isolate 記憶體快取那份（跟頁面同一份），不另外查 D1。
 */
export async function proxy(req: NextRequest) {
  const m = req.nextUrl.pathname.match(/^\/artist\/([^/]+)(?:\/(\d+)(?=\/|$))?(\/.*)?$/);
  if (m) {
    let slug = m[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* 解不開就照原字查 */
    }
    const to = await redirectPath(slug, m[2] ?? null, m[3] ?? "").catch(() => null);
    if (to) {
      const url = req.nextUrl.clone();
      url.pathname = to;
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
  if (!indexingAllowed() || isPrivatePath(req.nextUrl.pathname, req.nextUrl.search)) res.headers.set("X-Robots-Tag", "noindex");
  return res;
}
