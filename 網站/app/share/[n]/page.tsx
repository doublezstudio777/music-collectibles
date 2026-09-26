import Link from "next/link";
import { pageData } from "@/lib/server/viewer";
import { publicOffers } from "@/lib/server/trade";
import { ShareDetail } from "@/components/share-detail";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ n: string }> };

export async function generateMetadata({ params }: Props) {
  const { n } = await params;
  const { c } = await pageData();
  const s = c.getShare(Number(n));
  return { title: s ? s.what : "找不到這則炫收藏" };
}

export default async function SharePage({ params }: Props) {
  const { n: raw } = await params;
  const n = Number(raw);
  const { c } = await pageData();
  const share = Number.isInteger(n) ? c.getShare(n) : undefined;

  if (!share) {
    return (
      <main className="wrap page">
        <p className="empty">找不到這則炫收藏</p>
      </main>
    );
  }

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
