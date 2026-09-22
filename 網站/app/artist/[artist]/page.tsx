import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, ChevronRight } from "lucide-react";
import { artists, getArtist, versionsOfWork, worksOfArtist } from "@/lib/data";

export function generateStaticParams() {
  return artists.map((artist) => ({ artist: artist.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ artist: string }>;
}) {
  const { artist: slug } = await params;
  const artist = getArtist(slug);
  if (!artist) return { title: "找不到音樂人｜音藏" };
  return { title: `${artist.name}｜音藏`, description: artist.summary };
}

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ artist: string }>;
}) {
  const { artist: slug } = await params;
  const artist = getArtist(slug);
  if (!artist) notFound();

  const artistWorks = worksOfArtist(artist.slug);

  return (
    <main className="entry-shell">
      <nav className="breadcrumb" aria-label="麵包屑">
        <Link href="/work">作品</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{artist.name}</span>
      </nav>

      <div className="entry-layout">
        <article className="entry-body">
          <header className="entry-head">
            <h1>{artist.name}</h1>
            <p className="entry-lede">{artist.summary}</p>
          </header>

          <section aria-labelledby="intro-title">
            <h2 id="intro-title">簡介</h2>
            <p>{artist.intro}</p>
          </section>

          <section aria-labelledby="works-title">
            <h2 id="works-title">作品</h2>
            <ul className="artist-work-list">
              {artistWorks.map((work) => {
                const count = versionsOfWork(work.slug).length;
                return (
                  <li key={work.slug}>
                    <Link href={`/work/${work.slug}`}>
                      <span className="artist-work-copy">
                        <strong>{work.title}</strong>
                        <small>
                          {work.firstReleaseYear} · {work.workType} · {count}{" "}
                          個版本
                        </small>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 入圍與得獎跟官方合輯收錄分開記，見 00_現況.md */}
          <section aria-labelledby="awards-title">
            <h2 id="awards-title">
              <Award aria-hidden="true" />
              入圍與得獎
            </h2>
            {artist.awards.length ? (
              <div className="version-table-wrap">
                <table className="version-table">
                  <thead>
                    <tr>
                      <th scope="col">年份</th>
                      <th scope="col">獎項</th>
                      <th scope="col">類別</th>
                      <th scope="col">結果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artist.awards.map((award, index) => (
                      <tr key={index}>
                        <td>{award.year}</td>
                        <td>{award.award}</td>
                        <td>{award.category}</td>
                        <td>
                          <span
                            className={
                              award.result === "得獎"
                                ? "status-chip"
                                : "status-chip is-pending"
                            }
                          >
                            {award.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="section-note">目前沒有收錄的入圍或得獎紀錄。</p>
            )}
            <p className="rule-ref">
              獎項紀錄獨立存在。官方合輯依實際發行建檔，不由入圍名單生成。
            </p>
          </section>
        </article>

        <aside className="infobox" aria-label="音樂人資料">
          <h2 className="infobox-title">{artist.name}</h2>
          <dl className="infobox-list">
            <div>
              <dt>成立年份</dt>
              <dd>{artist.formedYear}</dd>
            </div>
            <div>
              <dt>所在地</dt>
              <dd>{artist.origin}</dd>
            </div>
            <div>
              <dt>收錄作品</dt>
              <dd>{artistWorks.length}</dd>
            </div>
            <div>
              <dt>入圍得獎</dt>
              <dd>{artist.awards.length}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
