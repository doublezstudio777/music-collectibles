import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // vinext 把所有 multipart POST 先當 server action 檢查大小，預設 1 MB 會在進到 /api/uploads 之前就回 413。
    // 照片上傳主圖上限 1.5 MB＋縮圖 0.2 MB（lib/server/photos.ts），放寬到 2 MB，真正的大小檢查在 API 裡。
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
