import Link from "next/link";
import { artistHref, GENDER_LABEL, REGION_LABEL, type ArtistGender, type ArtistRegion } from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { FollowButton } from "@/components/follow-button";

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

/** 藝人目錄：男歌手／女歌手／團體 × 國內／國外，再點一次取消 */
export default async function ArtistsPage({ searchParams }: Props) {
  const q = await searchParams;
  const g = GENDERS.includes(q.g as ArtistGender) ? (q.g as ArtistGender) : undefined;
  const r = REGIONS.includes(q.r as ArtistRegion) ? (q.r as ArtistRegion) : undefined;
  const { c } = await pageData();
  const list = c.artistDirectory(g, r).sort((a, b) => b.count - a.count || a.artist.name.localeCompare(b.artist.name, "zh-Hant"));
  return (
    <main className="wrap page">
      <header className="page-head">
        <h1 className="page-title">全部藝人</h1>
      </header>
      <nav className="dir-filters" aria-label="篩選">
        <div className="picks filter-picks">
          {GENDERS.map((x) => (
            <Link key={x} className="pick" href={href(g === x ? undefined : x, r)} aria-pressed={g === x} data-filter={`g-${x}`}>
              {GENDER_LABEL[x]}
            </Link>
          ))}
        </div>
        <div className="picks filter-picks">
          {REGIONS.map((x) => (
            <Link key={x} className="pick" href={href(g, r === x ? undefined : x)} aria-pressed={r === x} data-filter={`r-${x}`}>
              {REGION_LABEL[x]}
            </Link>
          ))}
        </div>
      </nav>
      {list.length === 0 ? (
        <p className="empty">沒有符合的藝人</p>
      ) : (
        <ul className="rows dir-list" data-testid="artist-dir">
          {list.map(({ artist: a, count }) => (
            <li key={a.slug} data-artist={a.slug}>
              <span className="row-main">
                <Link className="link dir-name" href={artistHref(a.slug)}>
                  {a.name}
                </Link>
                <span className="sub">
                  {[a.gender ? GENDER_LABEL[a.gender] : null, a.region ? REGION_LABEL[a.region] : null, `${count} 則收藏`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <FollowButton slug={a.slug} name={a.name} small />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
