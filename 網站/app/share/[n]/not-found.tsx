import Link from "@/components/link";

// 收藏不存在或已刪除（2026-10-02 設計總檢必修 1）：開放收錄後搜尋結果會連到被刪的收藏，說清楚不在了，再給出口
export const metadata = { title: "這則收藏已經不在了" };

export default function ShareNotFound() {
  return (
    <main id="main" className="wrap page page-narrow not-found" data-testid="share-not-found">
      <h1 className="page-title">這則收藏已經不在了</h1>
      <p className="page-meta">發文的人把它刪掉了，或這則收藏已經下架。</p>
      <form className="nf-search" action="/search" role="search">
        <input name="q" className="input" placeholder="搜尋藝人、系列、收藏" aria-label="搜尋藝人、系列、收藏" />
        <button className="btn btn-p" type="submit">
          搜尋
        </button>
      </form>
      <div className="nf-links">
        <Link className="btn btn-line" href="/">
          看最新的炫收藏
        </Link>
        <Link className="btn btn-line" href="/artists">
          看全部藝人
        </Link>
      </div>
    </main>
  );
}
