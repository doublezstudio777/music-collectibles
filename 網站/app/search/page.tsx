import Link from "next/link";
import { artistHref, creditNames, search, toShareView, workHref } from "@/lib/data";
import { ShareWall } from "@/components/share-wall";

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return { title: q ? `搜尋：${q}` : "搜尋" };
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const r = search(q);
  const total = r.artists.length + r.works.length + r.shares.length;

  return (
    <main className="wrap page">
      <form className="page-search" action="/search" role="search">
        <input name="q" className="input" defaultValue={q} placeholder="搜尋藝人、作品、收藏" aria-label="搜尋藝人、作品、收藏" />
        <button className="btn btn-p" type="submit">
          搜尋
        </button>
      </form>

      <header className="page-head">
        <h1 className="page-title">{q ? `「${q}」` : "全部作品"}</h1>
        {q ? (
          <p className="page-meta">
            <span className="num">{total}</span> 筆
          </p>
        ) : null}
      </header>

      {q && total === 0 ? <p className="empty">找不到「{q}」</p> : null}

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

      {r.works.length ? (
        <section className="block">
          <h2 className="block-title">
            作品 <span className="count">{r.works.length}</span>
          </h2>
          <ul className="rows">
            {r.works.map((w) => (
              <li key={`${w.artistSlug}/${w.no}`} className="row-cover">
                <span className="cover cover-sm" aria-hidden="true" />
                <span>
                  <Link className="link row-main" href={workHref(w)}>
                    {w.title}
                  </Link>
                  <span className="sub">
                    {creditNames(w).map((a) => a.name).join("、")} · {w.year} · {w.workType} · {w.versions.length} 個版本
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.shares.length ? (
        <section className="block">
          <h2 className="block-title">
            炫收藏 <span className="count">{r.shares.length}</span>
          </h2>
          <ShareWall shares={r.shares.map(toShareView)} />
        </section>
      ) : null}
    </main>
  );
}
