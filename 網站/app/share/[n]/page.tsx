import Link from "next/link";
import { getShare, shareHasTag, shares, tagHref, toShareView, userHref } from "@/lib/data";
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

  const view = toShareView(share);
  const byAuthor = shares.filter((s) => s.author === share.author && s.n !== n).slice(0, 3);
  const tag = share.about[0];
  const byTag = shares.filter((s) => s.n !== n && s.author !== share.author && shareHasTag(s, tag)).slice(0, 3);

  return (
    <main className="wrap page">
      <ShareDetail share={view} />
      {byAuthor.length ? (
        <section className="block">
          <div className="block-head">
            <h2 className="block-title">{view.author.name}的其他炫收藏</h2>
            <Link className="link" href={userHref(share.author)}>
              全部
            </Link>
          </div>
          <ShareWall shares={byAuthor.map(toShareView)} />
        </section>
      ) : null}
      {byTag.length ? (
        <section className="block">
          <div className="block-head">
            <h2 className="block-title">也跟{tag}有關</h2>
            <Link className="link" href={tagHref(tag)}>
              全部
            </Link>
          </div>
          <ShareWall shares={byTag.map(toShareView)} />
        </section>
      ) : null}
    </main>
  );
}
