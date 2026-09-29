// robots.txt：允許爬取（FB、Threads 的預覽爬蟲要讀得到頁面），只擋 /admin 與 /api。
// 不給搜尋引擎收錄靠頁面 <meta name="robots" content="noindex"> 與回應表頭 X-Robots-Tag（proxy.ts），
// 不用 Disallow 擋：擋了爬蟲讀不到 noindex，反而可能只憑網址收錄。開關是環境變數 ALLOW_INDEXING。
export const dynamic = "force-dynamic";

// 2026-09-29：AI 訓練與 AI 搜尋的爬蟲另外整站拒絕（照片與文字不給拿去訓練模型）。這只是聲明，守不守規矩看對方；
// 一般搜尋引擎與社群預覽爬蟲照舊走上面的 User-agent: *，noindex 的做法不變。
const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "Google-Extended",
  "CCBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "Amazonbot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "Timpibot",
  "DuckAssistBot",
  "MistralAI-User",
];

const ROBOTS_TXT = [
  "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n",
  ...AI_BOTS.map((b) => `User-agent: ${b}\nDisallow: /\n`),
].join("\n");

export function GET() {
  return new Response(ROBOTS_TXT, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
