// 連結預覽（FB、Threads、LINE 讀 og:*，X 讀 twitter:*）。單則、系列、藝人頁共用這一份。
// 圖片一律絕對網址；沒有可用的照片就用站方預設圖 public/og-default.png（1200×630）。
// 被鎖定的收藏：頁面照常可看，但預覽不露出原本的標題與照片（呼叫端傳通用字，photo 傳 null）。
// 被隱藏的內容：Catalog 讀不到，頁面直接 404，走不到這裡。

import type { Metadata } from "next";

export const OG_DEFAULT = { url: "/og-default.png", size: { w: 1200, h: 630 } };

type Photo = { url: string; size?: { w: number; h: number } } | null;

export function ogMeta({
  origin,
  path,
  title,
  description,
  photo,
  type = "website",
}: {
  origin: string;
  path: string;
  title: string;
  description: string;
  photo: Photo;
  type?: "website" | "article";
}): Metadata {
  const url = `${origin}${path}`;
  const img = photo ?? OG_DEFAULT;
  const image = {
    url: `${origin}${img.url}`,
    ...(img.size ? { width: img.size.w, height: img.size.h } : {}),
    alt: photo ? title : "音藏",
  };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type, siteName: "音藏", locale: "zh_TW", title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
