import Link from "next/link";
import { artistHref, GENDER_LABEL, REGION_LABEL, type ArtistGender, type ArtistRegion } from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { FaceImg } from "@/components/artist-faces";

export const metadata = { title: "全部藝人" };

type Props = { searchParams: Promise<{ g?: string; r?: string }> };

const GENDERS = Object.keys(GENDER_LABEL) as ArtistGender[];
const REGIONS = Object.keys(REGION_LABEL) as ArtistRegion[];

const href = (g?: string, r?: string) => {
  const q = new URLSearchParams();
  if (g) q.set("g", g);
  if (r) q.set("r", r);
  const s = q.toString();
  return s ? `/artists?${s}` : "/artists";
};

/**
 * 藝人目錄（2026-09-29 改圓圈格狀）：男歌手／女歌手／團體 × 國內／國外，篩選跟首頁排序同一套分頁籤樣式，再點一次取消。
 * 追蹤在藝人頁操作，這裡不放按鈕
 */
export default async function ArtistsPage({ searchParams }: Props) {
  const q = await searchParams;
  const g = GENDERS.includes(q.g as ArtistGender) ? (q.g as ArtistGender) : undefined;
  const r = REGIONS.includes(q.r as ArtistRegion) ? (q.r as ArtistRegion) : undefined;
  const { c } = await pageData();
  const list = c.artistDirectory(g, r);
  return (
    <main className="wrap page">
      <header className="page-head">
        <h1 className="page-title">全部藝人</h1>
      </header>
      <div className="wall-bar dir-bar">
        <nav className="filters" aria-label="類型">
          {GENDERS.map((x) => (
            <Link key={x} className="filter" href={href(g === x ? undefined : x, r)} aria-current={g === x ? "page" : undefined} data-filter={`g-${x}`}>
              {GENDER_LABEL[x]}
            </Link>
          ))}
        </nav>
        <nav className="filters" aria-label="地區">
          {REGIONS.map((x) => (
            <Link key={x} className="filter" href={href(g, r === x ? undefined : x)} aria-current={r === x ? "page" : undefined} data-filter={`r-${x}`}>
              {REGION_LABEL[x]}
            </Link>
          ))}
        </nav>
      </div>
      {list.length === 0 ? (
        <p className="empty">沒有符合的藝人</p>
      ) : (
        <ul className="face-grid" data-testid="artist-dir">
          {list.map((f, i) => (
            <li key={f.slug} className="face" data-artist={f.slug}>
              <Link className="face-link" href={artistHref(f.slug)}>
                <FaceImg face={f} eager={i < 12} />
                <span className="face-name">{f.name}</span>
                <span className="sub num">{f.count} 則收藏</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
