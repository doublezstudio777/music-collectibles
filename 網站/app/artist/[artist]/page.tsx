import Link from "next/link";
import { notFound } from "next/navigation";
import {
  compilationsOf,
  creditNames,
  getArtist,
  guestSeriesOf,
  mainSeriesOf,
  sharesWithTag,
  tagHref,
  toShareView,
  seriesHref,
} from "@/lib/data";
import { FollowButton } from "@/components/follow-button";
import { NextPhase } from "@/components/next-phase";
import { ShareWall } from "@/components/share-wall";
import { SeriesTile } from "@/components/work-cover";

type Props = { params: Promise<{ artist: string }> };

export async function generateMetadata({ params }: Props) {
  const a = getArtist((await params).artist);
  return { title: a ? a.name : "找不到藝人", description: a?.tagline };
}

export default async function ArtistPage({ params }: Props) {
  const artist = getArtist((await params).artist);
  if (!artist) notFound();

  const main = mainSeriesOf(artist.slug);
  const guests = guestSeriesOf(artist.slug);
  const comps = compilationsOf(artist.slug);
  const related = sharesWithTag(artist.name);

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
          <NextPhase label="編輯" />
          <NextPhase label="歷史" />
        </div>
      </header>

      {main.length ? (
        <section className="block">
          <h2 className="block-title">系列</h2>
          <ul className="tiles">
            {main.map((w) => (
              <SeriesTile key={`${w.artistSlug}/${w.no}`} series={w} except={artist.slug} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="block prose">
        {artist.intro.map((p) => (
          <p key={p.slice(0, 12)}>{p}</p>
        ))}
        <p className="edit-line">
          最後修改：{artist.lastEdit.by}，{artist.lastEdit.date}
        </p>
      </section>

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
                  <td>{creditNames(work).map((a) => a.name).join("、")}</td>
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
                  <td>{creditNames(work).map((a) => a.name).join("、")}</td>
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
          <ShareWall shares={related.slice(0, 3).map(toShareView)} />
        </section>
      ) : null}
    </main>
  );
}
