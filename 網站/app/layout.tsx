import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { AuthPanel } from "@/components/auth-panel";
import { sponsorUrl, turnstileSiteKey } from "@/lib/server/services";
import { indexingAllowed } from "@/lib/server/guard";
import { SITE_DESC } from "@/lib/data";
import { SITE_NAME, SITE_TITLE } from "@/lib/data";

// 不給搜尋引擎收錄（2026-09-26 定案，名稱定案後用 ALLOW_INDEXING=1 一次打開）
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: SITE_TITLE, template: `%s｜${SITE_NAME}` },
    description: SITE_DESC,
    ...(indexingAllowed() ? {} : { robots: { index: false } }),
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 贊助：全站最不顯眼的小字連結，網址在環境變數 SPONSOR_URL，沒設就整個不出現（2026-09-28）
  const sponsor = sponsorUrl();
  return (
    <html lang="zh-Hant-TW">
      <head>
        {/* 2026-09-30 Logo 定案（唱片紙套）：分頁用簡化小圖示（SVG＋32px PNG 備援），iPhone 主畫面用完整插圖 180px。
            直接寫在 <head>，不走 metadata.icons：vinext 會把 metadata 的圖示串流到 <body> 再靠 JS 搬，iOS 與爬蟲讀原始 HTML 看不到 */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SiteHeader />
        {children}
        <AuthPanel siteKey={turnstileSiteKey()} />
        <footer className="foot">
          <div className="wrap foot-row">
            <span>{SITE_NAME}</span>
            <p className="foot-note">照片著作權屬上傳者，封面與藝人名稱屬原權利人。</p>
            <nav className="foot-links" aria-label="法務">
              <Link href="/guide">新手指南</Link>
              <Link href="/ranking">收藏榮譽榜</Link>
              <Link href="/about">關於{SITE_NAME}</Link>
              <Link href="/verify">照片查證</Link>
              <Link href="/privacy">隱私權政策</Link>
              <Link href="/terms">使用條款</Link>
            </nav>
            {sponsor ? (
              <a className="foot-sponsor" href={sponsor} target="_blank" rel="noopener noreferrer" data-testid="sponsor">
                贊助
              </a>
            ) : null}
          </div>
        </footer>
      </body>
    </html>
  );
}
