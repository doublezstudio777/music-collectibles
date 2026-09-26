import Link from "next/link";
import { creditNames, seriesHref, type Series } from "@/lib/data";

/** 系列封面：純色塊，沒有真封面前不畫假圖 */
export function SeriesTile({ series, except }: { series: Series; except?: string }) {
  const others = creditNames(series).filter((a) => a.slug !== except);
  return (
    <li className="tile">
      <Link href={seriesHref(series)} className="tile-link">
        <span className="cover" aria-hidden="true" />
        <span className="tile-title">{series.name}</span>
      </Link>
      <span className="sub">{series.items.map((i) => i.kind).join("・")}</span>
      {others.length && except ? <span className="sub">與{others.map((a) => a.name).join("、")}共同署名</span> : null}
    </li>
  );
}
