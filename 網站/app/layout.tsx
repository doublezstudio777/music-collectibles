import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "留聲冊｜台灣音樂實體版本資料庫",
  description: "搜尋、辨認與整理台灣音樂實體版本，建立自己的收藏與願望清單。",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
