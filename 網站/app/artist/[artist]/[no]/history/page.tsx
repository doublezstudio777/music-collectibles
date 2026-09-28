import { notFound } from "next/navigation";
import { seriesHref } from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { history, isLocked, loadPage, targetKey, type WikiTarget } from "@/lib/server/wiki";
import { HistoryView } from "@/components/history-view";

// ?tracks={品項}-{版本}：看某個版本曲目的編輯歷史（2026-09-28）；沒帶就是系列正文
type Props = { params: Promise<{ artist: string; no: string }>; searchParams: Promise<{ a?: string; b?: string; tracks?: string }> };

export async function generateMetadata({ params, searchParams }: Props) {
  const { artist, no } = await params;
  const { c } = await pageData();
  const w = c.getSeries(artist, Number(no));
  const tracks = (await searchParams).tracks;
  return { title: w ? `${w.name}${tracks ? "的曲目" : ""}的編輯歷史` : "找不到系列" };
}

export default async function SeriesHistory({ params, searchParams }: Props) {
  const { artist, no } = await params;
  const { c } = await pageData();
  const w = c.getSeries(artist, Number(no));
  if (!w) notFound();
  const q = await searchParams;
  const tm = q.tracks?.match(/^([^#-]{1,40})-([^#-]{1,40})$/);
  if (q.tracks && !tm) notFound();
  const item = tm ? w.items.find((i) => i.id === tm[1]) : undefined;
  const ver = tm ? item?.versions.find((v) => v.id === tm[2]) : undefined;
  if (tm && !ver) notFound();
  const t: WikiTarget = tm
    ? { kind: "tracks", slug: w.artistSlug, no: w.no, item: tm[1], version: tm[2] }
    : { kind: "series", slug: w.artistSlug, no: w.no };
  const page = await loadPage(t);
  if (!page) notFound();
  return (
    <HistoryView
      title={tm ? `${w.name}・${item!.kind}「${ver!.edition}」曲目` : w.name}
      backHref={tm ? `${seriesHref(w)}#${tm[0]}` : seriesHref(w)}
      target={targetKey(t)}
      revisions={await history(t, page)}
      locked={await isLocked(t)}
      wikiUrl={null}
      a={q.a}
      b={q.b}
      query={tm ? `&tracks=${encodeURIComponent(tm[0])}` : ""}
    />
  );
}
