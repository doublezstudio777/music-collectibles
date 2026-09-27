import type { Metadata } from "next";
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
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    ...(indexingAllowed() ? {} : { robots: { index: false } }),
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 贊助：全站最不顯眼的小字連結，網址在環境變數 SPONSOR_URL，沒設就整個不出現（2026-09-28）
  const sponsor = sponsorUrl();
  return (
    <html lang="zh-Hant-TW">
      <head>
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
            <p className="foot-note">照片著作權屬於上傳者；專輯封面、藝人名稱等屬於原權利人。</p>
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
