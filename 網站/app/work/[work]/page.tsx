import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  FORMAT_CODE,
  getArtist,
  getWork,
  versionHref,
  versionKey,
  versionsOfWork,
  works,
  type Version,
} from "@/lib/data";

export function generateStaticParams() {
  return works.map((work) => ({ work: work.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ work: string }> }) {
  const { work: slug } = await params;
  const work = getWork(slug);
  if (!work) return { title: "找不到作品｜音藏" };
  const artist = getArtist(work.artistSlug);
  return {
    title: `${work.title}｜${artist?.name ?? ""}｜音藏`,
    description: work.intro,
  };
}

/** 版本差異對照要比的欄位。只列會因版本而異的，品況不在這裡 */
const COMPARE_FIELDS: { label: string; get: (v: Version) => string }[] = [
  { label: "發行年份", get: (v) => v.year },
  { label: "發行地區", get: (v) => v.region },
  { label: "發行公司", get: (v) => v.label },
  { label: "格式", get: (v) => v.format },
  { label: "目錄號", get: (v) => v.catalog },
  { label: "條碼", get: (v) => v.barcode },
  { label: "包裝形式", get: (v) => v.packaging },
  { label: "內容物", get: (v) => v.contents },
];

export default async function WorkPage({ params }: { params: Promise<{ work: string }> }) {
  const { work: slug } = await params;
  const work = getWork(slug);
  if (!work) notFound();

  const artist = getArtist(work.artistSlug);
  if (!artist) notFound();

  const workVersions = versionsOfWork(work.slug);
  const canCompare = workVersions.length > 1;

  return (
    <main className="entry-shell">
      <nav className="breadcrumb" aria-label="麵包屑">
        <Link href="/work">作品</Link>
        <ChevronRight aria-hidden="true" />
        <Link href={`/artist/${artist.slug}`}>{artist.name}</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{work.title}</span>
      </nav>

      <div className="entry-layout">
        <article className="entry-body">
          <header className="entry-head">
            <p className="entry-kicker">
              <Link href={`/artist/${artist.slug}`}>{artist.name}</Link>
            </p>
            <h1>{work.title}</h1>
            <p className="entry-lede">{work.intro}</p>
          </header>

          <section aria-labelledby="context-title">
            <h2 id="context-title">發行脈絡</h2>
            <p>{work.context}</p>
          </section>

          <section aria-labelledby="versions-title">
            <h2 id="versions-title">版本一覽</h2>
            <p className="section-note">
              同一張作品的每個版本各自是獨立條目。收藏、想要與分享都掛在版本上，不掛在作品上。
            </p>

            <div className="version-table-wrap">
              <table className="version-table">
                <thead>
                  <tr>
                    <th scope="col">版本</th>
                    <th scope="col">年份</th>
                    <th scope="col">地區</th>
                    <th scope="col">格式</th>
                    <th scope="col">目錄號</th>
                    <th scope="col">狀態</th>
                    <th scope="col">收藏</th>
                  </tr>
                </thead>
                <tbody>
                  {workVersions.map((version) => (
                    <tr key={versionKey(version)}>
                      <th scope="row">
                        <Link href={versionHref(version)}>{version.edition}</Link>
                        <small>{version.versionType}</small>
                      </th>
                      <td>{version.year}</td>
                      <td>{version.region}</td>
                      <td>{version.format}</td>
                      <td className="mono">{version.catalog}</td>
                      <td>
                        <span
                          className={
                            version.status === "已確認" ? "status-chip" : "status-chip is-pending"
                          }
                        >
                          {version.status}
                        </span>
                      </td>
                      <td className="numeric">
                        {version.owners} 人有 / {version.wanted} 人想要
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {canCompare && (
            <section aria-labelledby="compare-title">
              <h2 id="compare-title">版本差異對照</h2>
              <p className="section-note">
                只標出不同的欄位。保存狀況、單件簽名與賣家搭售物不列入，那些屬於個人收藏品，不構成新版本。
              </p>

              <div className="version-table-wrap">
                <table className="version-table compare-table">
                  <thead>
                    <tr>
                      <th scope="col">欄位</th>
                      {workVersions.map((version) => (
                        <th scope="col" key={versionKey(version)}>
                          <Link href={versionHref(version)}>{version.edition}</Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_FIELDS.map((field) => {
                      const values = workVersions.map((v) => field.get(v));
                      const differs = new Set(values).size > 1;
                      return (
                        <tr key={field.label} className={differs ? "row-differs" : undefined}>
                          <th scope="row">
                            {field.label}
                            {differs && <span className="diff-flag">有差異</span>}
                          </th>
                          {values.map((value, index) => (
                            <td key={index}>{value}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </article>

        <aside className="infobox" aria-label="作品資料">
          <h2 className="infobox-title">{work.title}</h2>
          <div className="infobox-cover">
            <span className={`cover ${workVersions[0]?.color ?? "cover-ink"}`} aria-hidden="true">
              <span className="cover-format">
                {FORMAT_CODE[workVersions[0]?.format ?? "CD"] ?? "CD"}
              </span>
            </span>
          </div>
          <dl className="infobox-list">
            <div>
              <dt>音樂人</dt>
              <dd>
                <Link href={`/artist/${artist.slug}`}>{artist.name}</Link>
              </dd>
            </div>
            <div>
              <dt>作品類型</dt>
              <dd>{work.workType}</dd>
            </div>
            <div>
              <dt>首次發行</dt>
              <dd>{work.firstReleaseYear}</dd>
            </div>
            <div>
              <dt>已收錄版本</dt>
              <dd>{workVersions.length}</dd>
            </div>
            <div>
              <dt>格式</dt>
              <dd>{[...new Set(workVersions.map((v) => v.format))].join("、")}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
