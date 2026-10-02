import Link from "@/components/link";
import { artistHref, seriesHref } from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { ShareWall } from "@/components/share-wall";

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string }> };

/** 系列結果每頁幾筆（2026-10-02 建議 21：短關鍵字會打到幾百個系列，分頁） */
const PAGE_SIZE = 30;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export async function generateMetadata({ searchParams }: Props) {
  const q = first((await searchParams).q);
  return { title: q ? `搜尋：${q}` : "搜尋" };
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = first(sp.q);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { c } = await pageData();

  // 沒輸入關鍵字（2026-10-02 建議 21）：不列 700 多個系列，改成提示＋熱門藝人＋最近新增的系列
  if (!q) {
    const hot = c
      .artistDirectory()
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count || a.artist.name.localeCompare(b.artist.name, "zh-Hant"))
      .slice(0, 12);
    const recent = c.seriesList.slice(-20).reverse();
    return (
      <main id="main" className="wrap page">
        <form className="page-search" action="/search" role="search">
          <input name="q" className="input" placeholder="搜尋藝人、系列、收藏" aria-label="搜尋藝人、系列、收藏" autoFocus />
          <button className="btn btn-p" type="submit">
            搜尋
          </button>
        </form>
        <header className="page-head">
          <h1 className="page-title">搜尋</h1>
          <p className="page-meta">打藝人、專輯、演唱會或版本的名字，也可以打目錄號、條碼。</p>
        </header>
        <div className="search-start" data-testid="search-start">
          {hot.length ? (
            <section className="block">
              <h2 className="block-title">熱門藝人</h2>
              <div className="search-artists" data-testid="search-hot">
                {hot.map(({ artist: a, count }) => (
                  <Link key={a.slug} className="pick" href={artistHref(a.slug)}>
                    {a.name}
                    <span className="sub-inline">　{count} 則</span>
                  </Link>
                ))}
              </div>
              <p className="page-meta">
                <Link className="link" href="/artists">
                  看全部藝人
                </Link>
              </p>
            </section>
          ) : null}
          {recent.length ? (
            <section className="block">
              <h2 className="block-title">最近新增的系列</h2>
              <ul className="rows" data-testid="search-recent">
                {recent.map((w) => (
                  <li key={`${w.artistSlug}/${w.no}`} className="row-cover">
                    <span className="cover cover-sm" aria-hidden="true" />
                    <span>
                      <Link className="link row-main" href={seriesHref(w)}>
                        {w.name}
                      </Link>
                      <span className="sub">
                        {c.creditNames(w).map((a) => a.name).join("、")} · {w.items.map((i) => i.kind).join("・")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    );
  }

  const r = c.search(q);
  const total = r.artists.length + r.series.length + r.shares.length;
  const pages = Math.max(1, Math.ceil(r.series.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const seriesShown = r.series.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const pageHref = (p: number) => `/search?q=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <main id="main" className="wrap page">
      <form className="page-search" action="/search" role="search">
        <input name="q" className="input" defaultValue={q} placeholder="搜尋藝人、系列、收藏" aria-label="搜尋藝人、系列、收藏" />
        <button className="btn btn-p" type="submit">
          搜尋
        </button>
      </form>

      <header className="page-head">
        <h1 className="page-title">「{q}」</h1>
        <p className="page-meta">
          <span className="num">{total}</span> 筆
        </p>
      </header>

      {total === 0 ? <p className="empty">找不到「{q}」</p> : null}

      {r.artists.length ? (
        <section className="block">
          <h2 className="block-title">
            藝人 <span className="count">{r.artists.length}</span>
          </h2>
          <ul className="rows">
            {r.artists.map((a) => (
              <li key={a.slug}>
                <Link className="link row-main" href={artistHref(a.slug)}>
                  {a.name}
                </Link>
                <span className="sub">
                  {a.kind === "發行單位" ? "發行單位 · " : ""}
                  {a.tagline}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.series.length ? (
        <section className="block">
          <h2 className="block-title">
            系列 <span className="count">{r.series.length}</span>
          </h2>
          <ul className="rows" data-testid="search-series">
            {seriesShown.map((w) => (
              <li key={`${w.artistSlug}/${w.no}`} className="row-cover">
                <span className="cover cover-sm" aria-hidden="true" />
                <span>
                  <Link className="link row-main" href={seriesHref(w)}>
                    {w.name}
                  </Link>
                  <span className="sub">
                    {c.creditNames(w).map((a) => a.name).join("、")} · {w.items.map((i) => i.kind).join("・")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="pager search-pager" aria-label="系列分頁" data-testid="search-pager">
              {cur > 1 ? (
                <Link className="btn btn-line" href={pageHref(cur - 1)}>
                  上一頁
                </Link>
              ) : (
                <span className="btn btn-line" aria-disabled="true">
                  上一頁
                </span>
              )}
              <span className="num">
                {cur} / {pages}
              </span>
              {cur < pages ? (
                <Link className="btn btn-line" href={pageHref(cur + 1)}>
                  下一頁
                </Link>
              ) : (
                <span className="btn btn-line" aria-disabled="true">
                  下一頁
                </span>
              )}
            </nav>
          ) : null}
        </section>
      ) : null}

      {r.shares.length ? (
        <section className="block">
          <h2 className="block-title">
            炫收藏 <span className="count">{r.shares.length}</span>
          </h2>
          <ShareWall shares={r.shares.map(c.toShareView)} />
        </section>
      ) : null}
    </main>
  );
}
