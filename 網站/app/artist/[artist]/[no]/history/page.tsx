import { notFound } from "next/navigation";
import { seriesHref } from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { history, isLocked, loadPage } from "@/lib/server/wiki";
import { HistoryView } from "@/components/history-view";

type Props = { params: Promise<{ artist: string; no: string }>; searchParams: Promise<{ a?: string; b?: string }> };

export async function generateMetadata({ params }: Props) {
  const { artist, no } = await params;
  const { c } = await pageData();
  const w = c.getSeries(artist, Number(no));
  return { title: w ? `${w.name}的編輯歷史` : "找不到系列" };
}

export default async function SeriesHistory({ params, searchParams }: Props) {
  const { artist, no } = await params;
  const { c } = await pageData();
  const w = c.getSeries(artist, Number(no));
  if (!w) notFound();
  const t = { kind: "series" as const, slug: w.artistSlug, no: w.no };
  const page = await loadPage(t);
  if (!page) notFound();
  const q = await searchParams;
  return (
    <HistoryView
      title={w.name}
      backHref={seriesHref(w)}
      target={`series:${w.artistSlug}/${w.no}`}
      revisions={await history(t, page)}
      locked={await isLocked(t)}
      wikiUrl={null}
      a={q.a}
      b={q.b}
    />
  );
}
