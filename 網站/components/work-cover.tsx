import Link from "next/link";
import { SERIES_KIND_LABEL, seriesHref, type Artist, type Series } from "@/lib/data";

/** 系列封面：純色塊，沒有真封面前不畫假圖。photo＝收藏者拍的照片縮圖（系列頁「其他系列」用，沒有就色塊） */
export function SeriesTile({ series, credits, except, photo }: { series: Series; credits: Artist[]; except?: string; photo?: string | null }) {
  const others = credits.filter((a) => a.slug !== except);
  return (
    <li className="tile">
      <Link href={seriesHref(series)} className="tile-link">
        {photo ? (
          <span className="cover cover-photo" aria-hidden="true" style={{ backgroundImage: `url(${photo})` }} />
        ) : (
          <span className="cover" aria-hidden="true" />
        )}
        <span className="tile-title">{series.name}</span>
      </Link>
      <span className="sub">
        <span className="kind-tag" data-series-kind={series.kind}>
          {SERIES_KIND_LABEL[series.kind]}
        </span>
        {series.items.map((i) => i.kind).join("・")}
      </span>
      {others.length && except ? <span className="sub">與{others.map((a) => a.name).join("、")}共同署名</span> : null}
    </li>
  );
}
