import Link from "next/link";
import { artistHref } from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ tag: string }> };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export async function generateMetadata({ params }: Props) {
  const { tag } = await params;
  return { title: decode(tag) };
}

export default async function TagPage({ params }: Props) {
  const tag = decode((await params).tag);
  const { c } = await pageData();
  const tagArtist = c.resolveTagArtist(tag);
  const artist = tagArtist && c.artistVisible(tagArtist) ? tagArtist : undefined;
  const list = c.sharesWithTag(tag).map(c.toShareView);

  return (
    <main className="wrap page">
      <header className="page-head">
        <h1 className="page-title">{tag}</h1>
        <p className="page-meta">
          <span className="num">{list.length}</span> 則炫收藏
          {artist ? (
            <>
              <span className="dot" aria-hidden="true">·</span>
              <Link className="link" href={artistHref(artist.slug)}>
                {artist.kind === "藝人" ? "藝人頁" : "發行單位頁"}
              </Link>
            </>
          ) : null}
        </p>
      </header>
      <ShareWall shares={list} empty={<p className="empty">還沒有人用過這個標籤</p>} />
    </main>
  );
}
