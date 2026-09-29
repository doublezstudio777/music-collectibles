import Link from "next/link";
import { pageData } from "@/lib/server/viewer";
import { ShareWall, type WallFilter, type WallSort } from "@/components/share-wall";
import { HomeTagline } from "@/components/home-tagline";
import { HomePick, type PickSong } from "@/components/home-pick";
import { enabledPicks } from "@/lib/server/spotify-picks";
import { GENDER_LABEL, REGION_LABEL, SITE_TITLE, type ArtistGender } from "@/lib/data";

type Props = { searchParams: Promise<{ state?: string; sort?: string; page?: string }> };

const GENDERS = Object.keys(GENDER_LABEL) as ArtistGender[];

export default async function Home({ searchParams }: Props) {
  const q = await searchParams;
  const filter: WallFilter = q.state === "selling" || q.state === "sale" || q.state === "offer" ? "selling" : "all";
  const sort: WallSort = q.sort === "likes" ? "likes" : q.sort === "new" ? "new" : "following";
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const { c } = await pageData();
  // 首頁上方（2026-09-29）：一首歌＋藝人分類。只推薦藝人目錄看得到的藝人
  const dir = c.artistDirectory();
  const bySlug = new Map(dir.map((d) => [d.artist.slug, d]));
  const songs: PickSong[] = (await enabledPicks()).flatMap((p) => {
    const d = bySlug.get(p.artistSlug);
    if (!d) return [];
    const a = d.artist;
    const meta = [a.gender ? GENDER_LABEL[a.gender] : null, a.region ? REGION_LABEL[a.region] : null, `${d.count} 則收藏`].filter(Boolean).join("・");
    return [{ track: p.trackId, slug: a.slug, name: a.name, meta, count: d.count }];
  });
  const byGender = (g: ArtistGender) => dir.filter((d) => d.artist.gender === g).length;
  return (
    <main className="wrap page page-wall">
      <h1 className="sr-only">{SITE_TITLE}</h1>
      <HomeTagline />
      <div className={songs.length ? "home-top" : "home-top is-solo"} data-testid="home-top">
        {songs.length ? <HomePick songs={songs} /> : null}
        <nav className="home-art" aria-labelledby="home-art-title" data-testid="home-art">
          <h2 id="home-art-title" className="home-art-title">
            藝人
          </h2>
          <div className="home-art-list">
            {GENDERS.map((g) => (
              <Link key={g} href={`/artists?type=${g}`} data-type={g}>
                <span>{GENDER_LABEL[g]}</span>
                <span className="num">{byGender(g)}</span>
              </Link>
            ))}
            <Link className="home-art-all" href="/artists" data-type="all">
              <span>全部藝人</span>
              <span className="num">{dir.length}</span>
            </Link>
          </div>
        </nav>
      </div>
      <ShareWall shares={c.allShareViews()} sortable paged filter={filter} initialSort={sort} page={page} />
    </main>
  );
}
