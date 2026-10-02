import Link from "@/components/link";
import { notFound } from "next/navigation";
import { SITE_DESC, shareDesc, shareHref, type Share } from "@/lib/data";
import { ARTISTS_CRUMB, HOME_CRUMB, artistCrumb, breadcrumbLd, ldJson, seriesCrumb, shareCrumb, shareIndex, seoMeta } from "@/lib/server/seo";
import { collectionDescription, collectionTitle, releaseLine, sharePhotoAlt, shareDescription, shareTitle } from "@/lib/seo";
import { ogPhoto, type Catalog } from "@/lib/catalog";
import { pageData, siteOrigin } from "@/lib/server/viewer";
import { publicOffers } from "@/lib/server/trade";
import { ShareDetail } from "@/components/share-detail";
import { CollectionDetail } from "@/components/collection-detail";
import { ShareWall } from "@/components/share-wall";
import { ShareComments } from "@/components/share-comments";
import { ShareQuestion } from "@/components/share-question";

type Props = { params: Promise<{ n: string }> };

// 收藏頁 metadata（2026-10-01 SEO）：標題「藝人《系列》版本 品項｜某某的收藏」，描述加發行年與內文前 40 字，
// canonical 固定正式網域。被鎖定（檢舉達門檻）的照舊只給通用字與站方預設圖，並且不收錄
export async function generateMetadata({ params }: Props) {
  const { n } = await params;
  const { c } = await pageData();
  const s = c.getShare(Number(n));
  if (!s) return { title: "找不到這則炫收藏" };
  const path = shareHref(s.n);
  const decision = shareIndex(c, s);
  if (c.toShareView(s).lock) {
    return seoMeta({ path, title: "一則炫收藏", description: SITE_DESC, photo: null, type: "article", index: false });
  }
  const author = s.authorName ?? s.author;
  // 全家福合集（2026-10-01）：標題、描述用標記的專輯組
  if (s.collection) {
    const tags = s.collection.tags.map((t) => c.collectionTagView(t.key)).filter((t) => t !== null);
    return seoMeta({
      path,
      title: collectionTitle({ artists: s.about, count: tags.length, custom: s.autoWhat ? s.what : undefined, author }),
      description: collectionDescription({ albums: tags.map((t) => `${t.artist}《${t.album}》`), count: tags.length, author, story: s.story }),
      photo: ogPhoto(s),
      type: "article",
      index: decision.index,
      alt: `${s.what}，${author}的收藏合照`,
    });
  }
  const parts = c.shareParts(s);
  const title = shareTitle(parts, s.what, author);
  return seoMeta({
    path,
    title,
    description: shareDescription(parts, shareYear(c, s), s.story, s.what),
    photo: ogPhoto(s),
    type: "article",
    index: decision.index,
    alt: sharePhotoAlt({ what: s.what, about: s.about, author: { name: author }, link: s.link }),
  });
}

/** 發行年：連到的版本（發行日期優先）→ 系列年份 */
function shareYear(c: Catalog, s: Share) {
  if (!s.link) return "";
  const w = c.getSeriesByKey(s.link.series);
  const r = s.link.item && s.link.version ? c.resolveVersionKey(`${s.link.series}#${s.link.item}-${s.link.version}`) : null;
  return r?.version.releaseDate || r?.version.year || w?.year || "";
}

export default async function SharePage({ params }: Props) {
  const { n: raw } = await params;
  const n = Number(raw);
  const { c } = await pageData();
  const share = Number.isInteger(n) ? c.getShare(n) : undefined;

  if (!share) notFound();
  const view = c.toDetailView(share);
  const origin = await siteOrigin();
  // 被鎖定的不給分享（分享按鈕不出現）
  const shareInfo = view.lock
    ? null
    : { url: `${origin}${shareHref(n)}`, title: share.what, text: share.collection ? `${share.what}｜${view.author.name}的收藏合照` : shareDesc(c.shareParts(share), view.author.name) };

  // 麵包屑（結構化資料）：首頁 › 藝人 › 第一位有公開頁的相關藝人 › 系列 › 這則
  const w = share.link ? c.getSeriesByKey(share.link.series) : undefined;
  const firstArtist = c.aboutSlugs(share).map((slug) => c.visibleArtist(slug)).find(Boolean) ?? (w ? c.visibleArtist(w.artistSlug) : undefined);
  const crumbs = [
    HOME_CRUMB,
    ARTISTS_CRUMB,
    ...(firstArtist ? [artistCrumb(firstArtist)] : []),
    ...(w ? [seriesCrumb(w)] : []),
    shareCrumb(n, view.lock ? "一則炫收藏" : (share.link ? releaseLine(c.shareParts(share)) : "") || share.what.replace(/・/g, " ")),
  ];

  // 底部只放跟同一個系列、藝人、標籤有關的，不放同一位會員的
  return (
    <main id="main" className="wrap page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson([breadcrumbLd(crumbs)]) }} />
      {share.collection ? (
        <CollectionDetail share={view} shareInfo={shareInfo} />
      ) : (
        <ShareDetail share={view} offers={await publicOffers(n)} shareInfo={shareInfo} />
      )}
      {/* 留言不在整頁快取裡，前端另外打 /api/comments 載入 */}
      <ShareComments share={n} />
      {c.relatedFor(share).map((b) => (
        <section className="block related" key={b.title}>
          <div className="block-head">
            <h2 className="block-title">{b.title}</h2>
            <Link className="link" href={b.href}>
              全部 {b.total} 則
            </Link>
          </div>
          <ShareWall shares={b.items.map(c.toShareView)} />
        </section>
      ))}
      {/* 回報入口（2026-09-28）：取代原本的「檢舉這則」，發文者自己看不到 */}
      <ShareQuestion n={n} author={share.author} />
    </main>
  );
}
