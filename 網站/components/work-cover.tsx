import Link from "next/link";
import { creditNames, workHref, type Work } from "@/lib/data";

/** 作品封面：純色塊，沒有真封面前不畫假圖 */
export function WorkTile({ work, except }: { work: Work; except?: string }) {
  const others = creditNames(work).filter((a) => a.slug !== except);
  return (
    <li className="tile">
      <Link href={workHref(work)} className="tile-link">
        <span className="cover" style={{ background: work.versions[0]?.color }} aria-hidden="true" />
        <span className="tile-title">{work.title}</span>
      </Link>
      <span className="sub">
        {work.year} · {work.workType} · {work.versions.length} 個版本
      </span>
      {others.length && except ? <span className="sub">與{others.map((a) => a.name).join("、")}共同署名</span> : null}
    </li>
  );
}
