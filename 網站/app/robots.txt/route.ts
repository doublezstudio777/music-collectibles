// robots.txt：允許爬取（FB、Threads 的預覽爬蟲要讀得到頁面），只擋 /admin 與 /api。
// 不給搜尋引擎收錄靠頁面 <meta name="robots" content="noindex"> 與回應表頭 X-Robots-Tag（proxy.ts），
// 不用 Disallow 擋：擋了爬蟲讀不到 noindex，反而可能只憑網址收錄。開關是環境變數 ALLOW_INDEXING。
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
