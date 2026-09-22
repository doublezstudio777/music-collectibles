import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Camera, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareActions } from "@/components/collection-actions";
import { SearchBox } from "@/components/search-box";
import {
  FORMAT_CODE,
  expandShare,
  getArtist,
  getWork,
  shares,
  versionHref,
  versionKey,
  versions,
} from "@/lib/data";

export default function Home() {
  const feed = shares.map(expandShare).filter((x) => x !== null);

  // 冷啟動用：待確認的版本本身就是貢獻的召集，不是空狀態
  const needsHelp = versions.filter((v) => v.status === "待確認");

  return (
    <main className="catalog-shell">
      <div className="catalog-heading">
        <h1>看看別人收了什麼</h1>
        <p className="heading-note">
          同一張專輯，不同年份、不同地區的版本長得不一樣。這裡有人把手上那件拍下來，講清楚差在哪。
        </p>
      </div>

      <SearchBox />

      <div className="discover-layout">
        <section className="share-feed" aria-labelledby="share-feed-title">
          <div className="panel-heading">
            <h2 id="share-feed-title">最近有人在分享</h2>
            <span className="quiet-label">依發布時間排序</span>
          </div>

          {feed.map(({ share, version, work, artist }) => (
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
                      alt="收藏者拍攝的實體收藏組合"
                      fill
                      sizes="(max-width: 700px) 100vw, 420px"
                    />
                  </div>
                )}
                <div className="share-copy">
                  {share.intent !== "展示" && <span className="share-tag">{share.intent}</span>}
                  <h3>{share.title}</h3>
                  <p>{share.story}</p>
                  <Link className="tagged-release" href={versionHref(version)}>
                    <span>
                      <strong>
                        {artist.name} · {work.title}
                      </strong>
                      <small>
                        {version.edition} · {version.format} · {version.status}
                      </small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <ShareActions shareId={share.id} versionKey={versionKey(version)} />
            </article>
          ))}
        </section>

        <aside className="side-column">
          <section className="side-panel" aria-labelledby="needs-help-title">
            <div className="panel-heading">
              <h2 id="needs-help-title">
                <HelpCircle aria-hidden="true" />
                需要幫忙辨識
              </h2>
            </div>
            <p className="side-note">
              這些版本還沒辦法確認。手上有同一件的話，拍張照就能幫上忙。
            </p>
            <ul className="needs-help-list">
              {needsHelp.map((version) => {
                const work = getWork(version.workSlug);
                const artist = work ? getArtist(work.artistSlug) : undefined;
                if (!work || !artist) return null;
                return (
                  <li key={versionKey(version)}>
                    <Link href={versionHref(version)}>
                      <span className={`cover cover-sm ${version.color}`} aria-hidden="true">
                        <span className="cover-format">
                          {FORMAT_CODE[version.format] ?? version.format}
                        </span>
                      </span>
                      <span className="needs-help-copy">
                        <strong>{work.title}</strong>
                        <small>
                          {artist.name} · {version.edition}
                        </small>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="invite-panel">
            <h2>把手上那件講清楚</h2>
            <p>
              拍下正面、背面和條碼，AI 會先整理成草稿。你只要確認資料對不對，再補一段自己的話。
            </p>
            <Button className="invite-button">
              <Camera aria-hidden="true" />
              分享一件收藏
            </Button>
            <div className="invite-steps">
              <span>
                <b>1</b>拍下包裝和辨識線索
              </span>
              <span>
                <b>2</b>AI 整理欄位、比對版本
              </span>
              <span>
                <b>3</b>本人確認過才公開
              </span>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
