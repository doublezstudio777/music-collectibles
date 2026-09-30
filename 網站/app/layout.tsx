import type { Metadata } from "next";
import Link from "@/components/link";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { AuthPanel } from "@/components/auth-panel";
import { TermsConsent } from "@/components/terms-consent";
import { sponsorUrl, turnstileSiteKey } from "@/lib/server/services";
import { indexingAllowed } from "@/lib/server/guard";
import { seoContext } from "@/lib/server/seo";
import { SITE_DESC } from "@/lib/data";
import { PHOTO_LICENSE_URL, SITE_NAME, SITE_TITLE } from "@/lib/data";

// 不給搜尋引擎收錄（2026-09-26 定案，名稱定案後用 ALLOW_INDEXING=1 一次打開）
// 標題後綴與預設描述（2026-10-01 SEO）：後台「全站 SEO 設定」可改，沒設用站名與 SITE_DESC（lib/server/seo.ts）
export async function generateMetadata(): Promise<Metadata> {
  const { site } = await seoContext().catch(() => ({ site: { suffix: SITE_NAME, description: SITE_DESC } }));
  return {
    title: { default: SITE_TITLE, template: `%s｜${site.suffix}` },
    description: site.description,
    ...(indexingAllowed() ? {} : { robots: { index: false } }),
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 贊助：全站最不顯眼的小字連結，網址在環境變數 SPONSOR_URL，沒設就整個不出現（2026-09-28）
  const sponsor = sponsorUrl();
  return (
    <html lang="zh-Hant-TW">
      <head>
        {/* 2026-09-30 Logo 定案（B 版正方形紙套）：分頁用簡化小圖示（SVG 沒有底線；PNG 備援 16px 沒底線、32px 留加粗底線），iPhone 主畫面用完整插圖 180px。
            直接寫在 <head>，不走 metadata.icons：vinext 會把 metadata 的圖示串流到 <body> 再靠 JS 搬，iOS 與爬蟲讀原始 HTML 看不到 */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16" />
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
        <TermsConsent />
        <footer className="foot">
          <div className="wrap foot-row">
            <span>{SITE_NAME}</span>
            <nav className="foot-links" aria-label="法務">
              <Link href="/guide">新手指南</Link>
              <Link href="/ranking">收藏榮譽榜</Link>
              <Link href="/about">關於{SITE_NAME}</Link>
              <Link href="/verify">照片查證</Link>
              <Link href="/privacy">隱私權政策</Link>
              <Link href="/terms">使用條款</Link>
              <Link href="/takedown">權利侵害通知</Link>
            </nav>
            {sponsor ? (
              <a className="foot-sponsor" href={sponsor} target="_blank" rel="noopener noreferrer" data-testid="sponsor">
                贊助
              </a>
            ) : null}
          </div>
          {/* 版權與照片授權（2026-09-30 使用者核准）：會員照片 CC BY-NC-ND 4.0。標章是官方 88×31 圖檔放站內，不外連圖片。
              2026-10-01 法務修正：文字照法務審閱 D4（原本上面那行「照片著作權屬上傳者…」併進來） */}
          <div className="wrap foot-cc" data-testid="foot-cc">
            <a href={PHOTO_LICENSE_URL} target="_blank" rel="license noopener" className="foot-cc-badge">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/cc-by-nc-nd-88x31.png" alt="CC BY-NC-ND 4.0" width={88} height={31} />
            </a>
            <p>
              © 2026 {SITE_NAME}　網站設計與資料之選擇編排屬{SITE_NAME}。會員照片著作權屬拍攝者，以 CC BY-NC-ND 4.0 授權：可分享，須標示拍攝者與{SITE_NAME}，不得商業使用、不得修改。藝人照片與簡介依各自標示的授權，專輯封面、商標與藝人名稱屬原權利人。
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
