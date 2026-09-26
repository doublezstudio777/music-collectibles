import Link from "next/link";
import { getShare, relatedFor, toShareView } from "@/lib/data";
import { ShareDetail } from "@/components/share-detail";
import { LocalShare } from "@/components/local-share";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ n: string }> };

export async function generateMetadata({ params }: Props) {
  const { n } = await params;
  const s = getShare(Number(n));
  return { title: s ? s.what : "炫收藏" };
}

export default async function SharePage({ params }: Props) {
  const { n: raw } = await params;
  const n = Number(raw);
  const share = getShare(n);

  if (!share) {
    return (
      <main className="wrap page">
        <LocalShare n={n} />
      </main>
    );
  }

  // 底部只放跟同一件作品、藝人、標籤有關的，不放同一位會員的
  return (
    <main className="wrap page">
      <ShareDetail share={toShareView(share)} />
      {relatedFor(share).map((b) => (
        <section className="block related" key={b.title}>
          <div className="block-head">
            <h2 className="block-title">{b.title}</h2>
            <Link className="link" href={b.href}>
              全部 {b.total} 則
            </Link>
          </div>
          <ShareWall shares={b.items.map(toShareView)} scope={b.scope} />
        </section>
      ))}
    </main>
  );
}
