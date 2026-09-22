import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Eye, ScanLine } from "lucide-react";
import { CollectionActions, ShareActions } from "@/components/collection-actions";
import {
  FORMAT_CODE,
  getArtist,
  getVersion,
  getWork,
  shares,
  versionHref,
  versionKey,
  versions,
  versionsOfWork,
} from "@/lib/data";

export function generateStaticParams() {
  return versions.map((version) => ({ work: version.workSlug, version: version.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ work: string; version: string }>;
}) {
  const { work: workSlug, version: versionSlug } = await params;
  const version = getVersion(workSlug, versionSlug);
  const work = getWork(workSlug);
  if (!version || !work) return { title: "找不到版本｜音藏" };
  const artist = getArtist(work.artistSlug);
  return {
    title: `${work.title} ${version.edition}｜${artist?.name ?? ""}｜音藏`,
    description: version.identifyBy,
  };
}

export default async function VersionPage({
  params,
}: {
  params: Promise<{ work: string; version: string }>;
}) {
  const { work: workSlug, version: versionSlug } = await params;
  const version = getVersion(workSlug, versionSlug);
  if (!version) notFound();

  const work = getWork(workSlug);
  if (!work) notFound();

  const artist = getArtist(work.artistSlug);
  if (!artist) notFound();

  const siblings = versionsOfWork(work.slug).filter((v) => v.slug !== version.slug);
  const versionShares = shares.filter((s) => s.versionSlug === version.slug);
  const key = versionKey(version);

  return (
    <main className="entry-shell">
      <nav className="breadcrumb" aria-label="麵包屑">
        <Link href="/work">作品</Link>
        <ChevronRight aria-hidden="true" />
        <Link href={`/artist/${artist.slug}`}>{artist.name}</Link>
        <ChevronRight aria-hidden="true" />
        <Link href={`/work/${work.slug}`}>{work.title}</Link>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page">{version.edition}</span>
      </nav>

      <div className="entry-layout">
        <article className="entry-body">
          <header className="entry-head">
            <p className="entry-kicker">
              <Link href={`/artist/${artist.slug}`}>{artist.name}</Link>
              <span aria-hidden="true"> · </span>
              <Link href={`/work/${work.slug}`}>{work.title}</Link>
            </p>
            <h1>{version.edition}</h1>
            <p className="entry-lede">
              {version.year} · {version.region} · {version.format} · {version.versionType}
            </p>
          </header>

          {/* 收藏者真正要的東西放最上面，不是資料展示 */}
          <section className="identify-block" aria-labelledby="identify-title">
            <h2 id="identify-title">
              <ScanLine aria-hidden="true" />
              怎麼認出這是這個版本
            </h2>
            <p className="identify-text">{version.identifyBy}</p>
          </section>

          <CollectionActions versionKey={key} />

          <div className="community-stats">
            <span>
              <strong>{version.owners}</strong> 人收藏
            </span>
            <span>
              <strong>{version.wanted}</strong> 人想要
            </span>
          </div>

          <section aria-labelledby="why-split-title">
            <h2 id="why-split-title">為什麼是獨立版本</h2>
            <p>{version.splitReason}</p>
            <p className="rule-ref">依據 {version.splitRule}</p>
          </section>

          {siblings.length > 0 && (
            <section aria-labelledby="siblings-title">
              <h2 id="siblings-title">同一張作品的其他版本</h2>
              <ul className="sibling-list">
                {siblings.map((sibling) => (
                  <li key={versionKey(sibling)}>
                    <Link href={versionHref(sibling)}>
                      <span className={`cover cover-sm ${sibling.color}`} aria-hidden="true">
                        <span className="cover-format">
                          {FORMAT_CODE[sibling.format] ?? sibling.format}
                        </span>
                      </span>
                      <span className="needs-help-copy">
                        <strong>{sibling.edition}</strong>
                        <small>
                          {sibling.year} · {sibling.region} · {sibling.catalog}
                        </small>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="text-link" href={`/work/${work.slug}`}>
                看版本差異對照
                <ChevronRight aria-hidden="true" />
              </Link>
            </section>
          )}

          {/* 分享掛在條目上，不自成一條河 */}
          <section aria-labelledby="shares-title">
            <h2 id="shares-title">
              <Eye aria-hidden="true" />
              收藏者怎麼說
            </h2>
            {versionShares.length ? (
              versionShares.map((share) => (
                <article className="share-card" key={share.id}>
                  <header className="share-author">
                    <span className="avatar">{share.initials}</span>
                    <span>
                      <strong>{share.authorName}</strong>
                      <small>{share.time}</small>
                    </span>
                  </header>
                  <div className={share.image ? "share-body has-image" : "share-body"}>
                    {share.image && (
                      <div className="share-photo">
                        <Image
                          src="/images/fictional-music-collection.jpg"
                          alt="收藏者拍攝的實體收藏"
                          fill
                          sizes="(max-width: 700px) 100vw, 360px"
                        />
                      </div>
                    )}
                    <div className="share-copy">
                      {share.intent !== "展示" && <span className="share-tag">{share.intent}</span>}
                      <h3>{share.title}</h3>
                      <p>{share.story}</p>
                    </div>
                  </div>
                  <ShareActions shareId={share.id} versionKey={key} />
                </article>
              ))
            ) : (
              <p className="section-note">
                還沒有人分享這個版本。手上有的話，拍張照片講一下辨識線索，這個條目就更完整。
              </p>
            )}
          </section>
        </article>

        <aside className="infobox" aria-label="版本資料">
          <h2 className="infobox-title">{version.edition}</h2>
          <div className="infobox-cover">
            <span className={`cover ${version.color}`} aria-hidden="true">
              <span className="cover-format">
                {FORMAT_CODE[version.format] ?? version.format}
              </span>
            </span>
          </div>
          <dl className="infobox-list">
            <div>
              <dt>版本類型</dt>
              <dd>{version.versionType}</dd>
            </div>
            <div>
              <dt>發行年份</dt>
              <dd>{version.year}</dd>
            </div>
            <div>
              <dt>發行地區</dt>
              <dd>{version.region}</dd>
            </div>
            <div>
              <dt>發行公司</dt>
              <dd>{version.label}</dd>
            </div>
            <div>
              <dt>授權單位</dt>
              <dd>{version.licensor}</dd>
            </div>
            <div>
              <dt>目錄號</dt>
              <dd className="mono">{version.catalog}</dd>
            </div>
            <div>
              <dt>條碼</dt>
              <dd className="mono">{version.barcode}</dd>
            </div>
            <div>
              <dt>格式</dt>
              <dd>{version.format}</dd>
            </div>
            <div>
              <dt>包裝形式</dt>
              <dd>{version.packaging}</dd>
            </div>
            <div>
              <dt>內容物</dt>
              <dd>{version.contents}</dd>
            </div>
            <div>
              <dt>資料狀態</dt>
              <dd>
                <span
                  className={
                    version.status === "已確認" ? "status-chip" : "status-chip is-pending"
                  }
                >
                  {version.status}
                </span>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
