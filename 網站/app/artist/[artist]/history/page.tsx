import { notFound } from "next/navigation";
import { artistHref } from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { history, isLocked, loadPage } from "@/lib/server/wiki";
import { HistoryView } from "@/components/history-view";

type Props = { params: Promise<{ artist: string }>; searchParams: Promise<{ a?: string; b?: string }> };

export async function generateMetadata({ params }: Props) {
  const { c } = await pageData();
  const a = c.visibleArtist((await params).artist);
  return { title: a ? `${a.name}的編輯歷史` : "找不到藝人" };
}

export default async function ArtistHistory({ params, searchParams }: Props) {
  const { c } = await pageData();
  const artist = c.visibleArtist((await params).artist);
  if (!artist) notFound();
  const t = { kind: "artist" as const, slug: artist.slug };
  const page = await loadPage(t);
  if (!page) notFound();
  const q = await searchParams;
  return (
    <HistoryView
      title={artist.name}
      backHref={artistHref(artist.slug)}
      target={`artist:${artist.slug}`}
      revisions={await history(t, page)}
      locked={await isLocked(t)}
      wikiUrl={page.wikiUrl}
      a={q.a}
      b={q.b}
    />
  );
}
