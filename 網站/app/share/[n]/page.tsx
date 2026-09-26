import Link from "next/link";
import { notFound } from "next/navigation";
import { KIND_LABEL_FALLBACK, shareHref } from "@/lib/data";
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
  // 分享到 FB、Threads 時的預覽：標題、一句描述、那則收藏的主圖、網址
  const origin = await siteOrigin();
  const url = `${origin}${shareHref(s.n)}`;
  const desc = (s.story || `${s.authorName ?? s.author} 的${s.kind || KIND_LABEL_FALLBACK}`).replace(/\s+/g, " ").slice(0, 120);
  return {
    title: s.what,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "音藏",
      locale: "zh_TW",
      title: s.what,
      description: desc,
      url,
      ...(s.image ? { images: [{ url: `${origin}${s.image}`, alt: s.what }] } : {}),
    },
  };
}

export default async function SharePage({ params }: Props) {
  const { n: raw } = await params;
  const n = Number(raw);
  const { c } = await pageData();
  const share = Number.isInteger(n) ? c.getShare(n) : undefined;

  if (!share) notFound();

  // 底部只放跟同一個系列、藝人、標籤有關的，不放同一位會員的
  return (
    <main className="wrap page">
      <ShareDetail share={c.toShareView(share)} offers={await publicOffers(n)} />
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
