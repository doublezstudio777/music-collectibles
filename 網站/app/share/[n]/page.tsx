import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_DESC, shareDesc, shareHref } from "@/lib/data";
import { ogMeta } from "@/lib/server/og";
import { ogPhoto } from "@/lib/catalog";
import { pageData, siteOrigin } from "@/lib/server/viewer";
import { publicOffers } from "@/lib/server/trade";
import { ShareDetail } from "@/components/share-detail";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ n: string }> };

export async function generateMetadata({ params }: Props) {
  const { n } = await params;
  const { c } = await pageData();
  const s = c.getShare(Number(n));
  if (!s) return { title: "找不到這則炫收藏" };
  const origin = await siteOrigin();
  const path = shareHref(s.n);
  // 被鎖定的：預覽只給通用字與站方預設圖，不露出原本的標題與照片
  if (c.toShareView(s).lock) {
    return ogMeta({ origin, path, title: "一則炫收藏", description: SITE_DESC, photo: null, type: "article" });
  }
  return ogMeta({
    origin,
    path,
    title: s.what,
    description: shareDesc(c.shareParts(s), s.authorName ?? s.author),
    photo: ogPhoto(s),
    type: "article",
  });
}

export default async function SharePage({ params }: Props) {
  const { n: raw } = await params;
  const n = Number(raw);
  const { c } = await pageData();
  const share = Number.isInteger(n) ? c.getShare(n) : undefined;

  if (!share) notFound();
  const view = c.toShareView(share);
  const origin = await siteOrigin();
  const parts = c.shareParts(share);
  // 被鎖定的不給分享（按鈕與分享圖都不出現）
  const shareInfo = view.lock
    ? null
    : { url: `${origin}${shareHref(n)}`, title: share.what, text: shareDesc(parts, view.author.name), parts };

  // 底部只放跟同一個系列、藝人、標籤有關的，不放同一位會員的
  return (
    <main className="wrap page">
      <ShareDetail share={view} offers={await publicOffers(n)} shareInfo={shareInfo} />
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
    </main>
  );
}
