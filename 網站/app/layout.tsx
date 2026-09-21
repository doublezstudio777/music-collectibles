import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "音藏｜台灣音樂的版本與收藏",
  description:
    "同一張專輯，不同年份、不同地區的版本長得不一樣。音藏收錄台灣音樂的實體版本差異，也讓收藏的人把自己手上那件講清楚。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Serif+TC:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
