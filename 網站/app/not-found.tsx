import Link from "@/components/link";
import { SITE_NAME } from "@/lib/data";

// 自製 404（2026-10-02 設計總檢必修 1）：沿用站內版型（頁首頁尾由 layout 帶），不用框架預設的英文頁。
// 深色模式：全站只做淺色，layout 已宣告 color-scheme: light，頁首白底不會跟著變黑。
export const metadata = { title: "找不到這一頁" };

export default function NotFound() {
  return (
    <main id="main" className="wrap page page-narrow not-found" data-testid="not-found">
      <h1 className="page-title">找不到這一頁</h1>
      <p className="page-meta">網址可能打錯，或這一頁已經移走了。</p>
      <form className="nf-search" action="/search" role="search">
        <input name="q" className="input" placeholder="搜尋藝人、系列、收藏" aria-label="搜尋藝人、系列、收藏" />
        <button className="btn btn-p" type="submit">
          搜尋
        </button>
      </form>
      <div className="nf-links">
        <Link className="btn btn-line" href="/">
          回{SITE_NAME}首頁
        </Link>
        <Link className="btn btn-line" href="/artists">
          看全部藝人
        </Link>
      </div>
    </main>
  );
}
