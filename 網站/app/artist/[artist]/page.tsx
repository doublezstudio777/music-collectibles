import Link from "next/link";
import { notFound } from "next/navigation";
import { artistHref, seriesHref, tagHref } from "@/lib/data";
import { latestRevisionId } from "@/lib/server/wiki";
import { pageData } from "@/lib/server/viewer";
import { FollowButton } from "@/components/follow-button";
import { WikiEditor } from "@/components/wiki-editor";
import { isLocked, lastEdit, loadPage } from "@/lib/server/wiki";
import { ShareWall } from "@/components/share-wall";
import { SeriesTile } from "@/components/work-cover";

type Props = { params: Promise<{ artist: string }>; searchParams: Promise<{ edit?: string }> };

export async function generateMetadata({ params }: Props) {
  const { c } = await pageData();
  const a = c.visibleArtist((await params).artist);
  return { title: a ? a.name : "找不到藝人", description: a?.tagline };
}

export default async function ArtistPage({ params, searchParams }: Props) {
  const { c } = await pageData();
  // 沒有任何系列也沒有任何收藏的藝人頁不對外顯示（管理員可強制開關），直接打網址回 404
  const artist = c.visibleArtist((await params).artist);
  if (!artist) notFound();
  const editing = (await searchParams).edit === "1";
  const wt = { kind: "artist" as const, slug: artist.slug };
  const [page, locked, edited] = await Promise.all([loadPage(wt), isLocked(wt), lastEdit(wt)]);
  const self = artistHref(artist.slug);
  const lastBy = edited ?? artist.lastEdit;

  const main = c.mainSeriesOf(artist.slug);
  const guests = c.guestSeriesOf(artist.slug);
  const comps = c.compilationsOf(artist.slug);
  const related = c.sharesWithTag(artist.name);

  return (
    <main className="wrap page">
      <header className="page-head head-split">
        <div>
          <h1 className="page-title">{artist.name}</h1>
          <p className="page-meta">
            {artist.kind === "發行單位" ? (
              <>
                發行單位<span className="dot" aria-hidden="true">·</span>
              </>
            ) : null}
            {artist.tagline}
          </p>
        </div>
        <div className="head-actions">
          <FollowButton slug={artist.slug} name={artist.name} />
          <Link className="btn btn-line" href={`${self}?edit=1#intro`} data-testid="edit-link">
            編輯
          </Link>
          <Link className="btn btn-line" href={`${self}/history`}>
            歷史
          </Link>
        </div>
      </header>

      {main.length ? (
        <section className="block">
          <h2 className="block-title">系列</h2>
          <ul className="tiles">
            {main.map((w) => (
              <SeriesTile key={`${w.artistSlug}/${w.no}`} series={w} credits={c.creditNames(w)} except={artist.slug} />
            ))}
          </ul>
        </section>
      ) : null}

      {artist.intro.length || editing ? (
        <section id="intro" className="block prose">
          {editing ? (
            <WikiEditor
              target={`artist:${artist.slug}`}
              paras={page?.content ?? artist.intro}
              baseId={page ? await latestRevisionId(`artist:${artist.slug}`) : 0}
              locked={locked}
              closeHref={self}
              label="簡介"
            />
          ) : (
            artist.intro.map((p, i) => <p key={i}>{p}</p>)
          )}
          {artist.wiki ? (
            <p className="edit-line" data-testid="wiki-credit">
              來源：
              <a className="link" href={artist.wiki.url} rel="noopener" target="_blank">
                維基百科
              </a>
              ，以{" "}
              <a className="link" href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hant" rel="license noopener" target="_blank">
                {artist.wiki.license}
              </a>{" "}
              授權{edited ? "；音藏使用者改寫的版本同樣以此授權" : ""}
            </p>
          ) : null}
          <p className="edit-line" data-testid="last-edit">
            最後修改：{lastBy.by}，{lastBy.date}
            <span className="dot" aria-hidden="true">·</span>
            <Link className="link" href={`${self}/history`}>
              歷史
            </Link>
          </p>
        </section>
      ) : null}

      {guests.length ? (
        <section className="block">
          <h2 className="block-title">合作與客串</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>系列</th>
                <th>署名</th>
                <th>參與</th>
                <th className="num-col">年</th>
              </tr>
            </thead>
            <tbody>
              {guests.map(({ series: work, role, track }) => (
                <tr key={`${work.artistSlug}/${work.no}-${track}`}>
                  <td>
                    <Link className="link" href={seriesHref(work)}>
                      {work.name}
                    </Link>
                  </td>
                  <td>{c.creditNames(work).map((a) => a.name).join("、")}</td>
                  <td>
                    {track} {role}
                  </td>
                  <td className="num-col mono">{work.year}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {comps.length ? (
        <section className="block">
          <h2 className="block-title">合輯收錄</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>系列</th>
                <th>發行</th>
                <th>收錄</th>
                <th className="num-col">年</th>
              </tr>
            </thead>
            <tbody>
              {comps.map(({ series: work, track }) => (
                <tr key={`${work.artistSlug}/${work.no}`}>
                  <td>
                    <Link className="link" href={seriesHref(work)}>
                      {work.name}
                    </Link>
                  </td>
                  <td>{c.creditNames(work).map((a) => a.name).join("、")}</td>
                  <td>{track}</td>
                  <td className="num-col mono">{work.year}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {artist.awards.length ? (
        <section className="block">
          <h2 className="block-title">獎項</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th className="num-col-l">年</th>
                <th>獎項</th>
                <th>類別</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {artist.awards.map((x) => (
                <tr key={`${x.year}-${x.category}`}>
                  <td className="mono">{x.year}</td>
                  <td>{x.award}</td>
                  <td>{x.category}</td>
                  <td>{x.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {related.length ? (
        <section className="block">
          <div className="block-head">
            <h2 className="block-title">相關收藏</h2>
            <Link className="link" href={tagHref(artist.name)}>
              全部 {related.length} 則
            </Link>
          </div>
          <ShareWall shares={related.slice(0, 3).map(c.toShareView)} />
        </section>
      ) : null}
    </main>
  );
}
