import Link from "@/components/link";
import { notFound } from "next/navigation";
import { artistHref, seriesHref, type Series } from "@/lib/data";
import { latestRevisionId } from "@/lib/server/wiki";
import { pageData } from "@/lib/server/viewer";
import { ARTISTS_CRUMB, HOME_CRUMB, artistCrumb, artistDescription, artistIndex, artistLd, artistTitle, breadcrumbLd, ldJson, overrideOf, overridePhoto, pick, seoContext, seoMeta } from "@/lib/server/seo";
import { CopyLink } from "@/components/share-actions";
import { FollowButton } from "@/components/follow-button";
import { WikiEditor } from "@/components/wiki-editor";
import { FillLink } from "@/components/fill-link";
import { isLocked, lastEdit, loadPage } from "@/lib/server/wiki";
import { ShareWall } from "@/components/share-wall";
import { SeriesTile } from "@/components/work-cover";
import { SITE_NAME } from "@/lib/data";
import { activeArtistPhoto } from "@/lib/server/artist-photos";
import { ArtistPhotoFigure, ArtistPhotoPlaceholder } from "@/components/artist-photo";
import { ArtistPhotoSubmit } from "@/components/artist-photo-submit";
import { spotifyArtistId } from "@/lib/server/spotify-picks";

type Props = { params: Promise<{ artist: string }>; searchParams: Promise<{ edit?: string }> };

// 藝人頁 metadata（2026-10-01 SEO）：標題「某某｜專輯、版本與收藏」，描述＝定位＋系列與收藏數＋簡介開頭，
// canonical 固定正式網域（?edit=1 也指回本頁）。後台可覆寫；內容太空、待確認、後台設定不收錄時 noindex（lib/server/seo.ts）
export async function generateMetadata({ params }: Props) {
  const [{ c }, ctx] = await Promise.all([pageData(), seoContext()]);
  const a = c.visibleArtist((await params).artist);
  if (!a) return { title: "找不到藝人" };
  const o = overrideOf(ctx, `artist:${a.slug}`);
  const related = c.sharesWithTag(a.name);
  // 藝人照片（2026-09-28）：有使用中的照片就當 og:image。這張不是會員的收藏，不燒浮水印；授權標示在頁面上。
  // 2026-10-01 法務修正：維基共享資源的照片（CC BY-SA 等）不當預覽圖，貼到 FB、LINE 時旁邊沒有攝影者與授權標示；
  // 只有會員投稿的照片（使用條款第 7 條授權樂迷藏產生連結預覽圖）才用，其他退回會員收藏照片或預設圖
  const active = await activeArtistPhoto(a.slug);
  const photo = active?.source === "member" ? active : null;
  return seoMeta({
    path: artistHref(a.slug),
    title: pick(o.title, artistTitle(a)),
    description: pick(o.description, artistDescription(c, a)),
    photo:
      overridePhoto(o) ??
      (photo
        ? { url: photo.url, ...(photo.width && photo.height ? { size: { w: photo.width, h: photo.height } } : {}), type: photo.contentType === "image/webp" ? "image/webp" : "image/jpeg" }
        : c.ogPhotoOf(related)),
    index: artistIndex(c, ctx, a).index,
    alt: `${a.name}照片`,
  });
}

export default async function ArtistPage({ params, searchParams }: Props) {
  const { c } = await pageData();
  // 沒有任何系列也沒有任何收藏的藝人頁不對外顯示（管理員可強制開關），直接打網址回 404
  const artist = c.visibleArtist((await params).artist);
  if (!artist) notFound();
  const editing = (await searchParams).edit === "1";
  const wt = { kind: "artist" as const, slug: artist.slug };
  const [page, locked, edited, photo, spotifyId] = await Promise.all([loadPage(wt), isLocked(wt), lastEdit(wt), activeArtistPhoto(artist.slug), spotifyArtistId(artist.slug)]);
  const self = artistHref(artist.slug);
  const lastBy = edited ?? artist.lastEdit;

  // 系列依發行年排序，新的在前；年份不明的排最後（同年份流水號大的在前）
  const yearOf = (w: Series) => (/^\d{4}/.test(w.year) ? Number(w.year.slice(0, 4)) : -1);
  // 「周邊與其他」（misc）一律排最後
  const miscLast = (x: Series, y: Series) => (x.kind === "misc" ? 1 : 0) - (y.kind === "misc" ? 1 : 0);
  const newest = (x: Series, y: Series) =>
    miscLast(x, y) || (yearOf(x) < 0 ? 1 : 0) - (yearOf(y) < 0 ? 1 : 0) || yearOf(y) - yearOf(x) || y.no - x.no;
  const main = c.mainSeriesOf(artist.slug).sort(newest);
  const guests = c.guestSeriesOf(artist.slug).sort((x, y) => newest(x.series, y.series));
  const comps = c.compilationsOf(artist.slug).sort((x, y) => newest(x.series, y.series));
  const related = c.sharesWithTag(artist.name);

  const ctx = await seoContext();
  const ld = ldJson([artistLd(c, ctx, artist, photo?.url ?? null), breadcrumbLd([HOME_CRUMB, ARTISTS_CRUMB, artistCrumb(artist)])]);

  return (
    <main id="main" className="wrap page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      {/* 藝人頁頭部（2026-10-03 用戶回饋）：照片維持直式放左，藝人名、類型、按鈕放右；沒照片放直式佔位圖。10/01 的手機滿寬 4:3 橫裁作廢 */}
      <header className={`page-head artist-head${photo ? " has-photo" : " no-photo"}`} data-testid="artist-head">
        {photo ? <ArtistPhotoFigure photo={photo} name={artist.name} /> : <ArtistPhotoPlaceholder />}
        <div className="artist-head-text">
          <h1 className="page-title">{artist.name}</h1>
          <p className="page-meta">
            {artist.kind === "發行單位" ? (
              <>
                發行單位<span className="dot" aria-hidden="true">·</span>
              </>
            ) : null}
            {artist.tagline}
          </p>
          {/* 主要動作「追蹤」「我收藏了哪些」；複製連結、編輯、歷史一列小文字連結，手機靠右欄底部 */}
          <div className="head-actions artist-actions">
            <div className="artist-main-acts">
              <FollowButton slug={artist.slug} name={artist.name} />
              {/* 一次勾選「我有」（2026-10-01）：個人頁面，不在整頁快取裡 */}
              <Link className="btn btn-line" href={`/me/owned/${artist.slug}`} data-testid="owned-entry">
                我收藏了哪些
              </Link>
            </div>
            <p className="artist-sub-acts">
              <CopyLink className="link-btn" />
              <Link className="link-btn" href={`${self}?edit=1#intro`} data-testid="edit-link">
                編輯
              </Link>
              <Link className="link-btn" href={`${self}/history`}>
                歷史
              </Link>
            </p>
          </div>
        </div>
        {/* 投稿入口與表單整寬排在照片與文字之下（手機右欄太窄放不下表單） */}
        <div className="artist-submit-row">
          <ArtistPhotoSubmit slug={artist.slug} name={artist.name} />
        </div>
      </header>

      {main.length ? (
        <section className="block">
          <h2 className="block-title">系列</h2>
          <ul className="tiles">
            {main.map((w) => (
              <SeriesTile key={`${w.artistSlug}/${w.no}`} series={w} credits={c.creditNames(w)} except={artist.slug} photo={c.seriesCover(w)} />
            ))}
          </ul>
        </section>
      ) : null}

      {spotifyId ? (
        // 在 Spotify 上的熱門歌曲（2026-10-01）：Spotify 官方藝人嵌入播放器，熱門歌曲由 Spotify 決定；跟首頁一樣自動載入
        <section className="block" data-testid="artist-spotify">
          <h2 className="block-title">在 Spotify 上的熱門歌曲</h2>
          <iframe
            className="artist-sp"
            title={`${artist.name}在 Spotify 上的熱門歌曲`}
            src={`https://open.spotify.com/embed/artist/${spotifyId}?utm_source=generator`}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
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
              授權{edited ? `；${SITE_NAME}使用者改寫的版本同樣以此授權` : ""}
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
      ) : (
        <section id="intro" className="block">
          <p className="fill-row" data-testid="intro-missing">
            <span className="fill-label">簡介待補</span>
            <FillLink href={`${self}?edit=1#intro`} testid="intro-fill" />
          </p>
        </section>
      )}

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
            <span className="sub" data-testid="related-count">
              {related.length} 則
            </span>
          </div>
          {/* 2026-09-28：藝人名標籤直接連到這頁，/tag/{藝人名} 301 過來，所以這裡列全部，不再連出去 */}
          <ShareWall shares={related.map(c.toShareView)} />
        </section>
      ) : null}
    </main>
  );
}
