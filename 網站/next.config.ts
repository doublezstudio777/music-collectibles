import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SEO（2026-10-01）：title、description、canonical、robots、og 一律輸出在 <head>，不走串流（預設只有「只讀 HTML 的爬蟲」拿得到 head 版，
  // 其他人拿到的是塞在 <body> 的版本，靠 JS 搬。Google 不認 <body> 裡的 canonical）。整頁快取不分 User-Agent，
  // 所以要所有人都拿同一個 head 版：比對任何 User-Agent（沒帶 User-Agent 的請求 worker.ts 補一個）
  htmlLimitedBots: /.*/,
  experimental: {
    // vinext 把所有 multipart POST 先當 server action 檢查大小，預設 1 MB 會在進到 /api/uploads 之前就回 413。
    // 照片上傳主圖上限 1.5 MB＋縮圖 0.2 MB（lib/server/photos.ts），放寬到 2 MB，真正的大小檢查在 API 裡。
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
