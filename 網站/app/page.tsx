import Link from "@/components/link";
import { pageData } from "@/lib/server/viewer";
import { ShareWall, type WallFilter, type WallSort } from "@/components/share-wall";
import { HomeTagline } from "@/components/home-tagline";
import { HomePick, type PickSong } from "@/components/home-pick";
import { homePicks } from "@/lib/server/spotify-picks";
import { GENDER_LABEL, REGION_LABEL, SITE_NAME, SITE_TITLE, type ArtistGender } from "@/lib/data";
import { ldJson, overrideOf, overridePhoto, pick, seoContext, seoMeta } from "@/lib/server/seo";
import { CANONICAL_ORIGIN } from "@/lib/seo";

type Props = { searchParams: Promise<{ state?: string; sort?: string; page?: string }> };

const GENDERS = Object.keys(GENDER_LABEL) as ArtistGender[];

// 首頁 metadata（2026-10-01 SEO）：原本沒有 og 標籤，補上站方預設圖；後台可覆寫標題、描述、og 圖、不收錄。
// ?state、?sort 這些篩選版本 canonical 指回首頁；分頁（?page=2 起）各自是自己的 canonical
export async function generateMetadata({ searchParams }: Props) {
  const ctx = await seoContext();
  const o = overrideOf(ctx, "page:home");
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  return seoMeta({
    path: page > 1 ? `/?page=${page}` : "/",
    title: pick(o.title, SITE_TITLE),
    description: pick(o.description, ctx.site.description),
    photo: overridePhoto(o),
    absolute: true,
    index: !o.noindex,
  });
}

export default async function Home({ searchParams }: Props) {
  const q = await searchParams;
  const filter: WallFilter = q.state === "selling" || q.state === "sale" || q.state === "offer" ? "selling" : "all";
  const sort: WallSort = q.sort === "likes" ? "likes" : q.sort === "new" ? "new" : "following";
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const { c } = await pageData();
  // 首頁上方（2026-09-29）：一首歌＋藝人分類。只推薦藝人目錄看得到的藝人（歌來自每天自動抽歌，沒有的藝人用手動歌單，2026-09-30）
  const dir = c.artistDirectory();
  const bySlug = new Map(dir.map((d) => [d.artist.slug, d]));
  const songs: PickSong[] = (await homePicks()).flatMap((p) => {
    const d = bySlug.get(p.artistSlug);
    if (!d) return [];
    const a = d.artist;
    const meta = [a.gender ? GENDER_LABEL[a.gender] : null, a.region ? REGION_LABEL[a.region] : null, `${d.count} 則收藏`].filter(Boolean).join("・");
    return [{ track: p.trackId, slug: a.slug, name: a.name, meta, count: d.count }];
  });
  // 2026-10-02 之後再說 3：有收藏的藝人才推（按過去是空的藝人頁）；全部都 0 則時才退回全部
  const songsShown = songs.some((s) => s.count > 0) ? songs.filter((s) => s.count > 0) : songs;
  const byGender = (g: ArtistGender) => dir.filter((d) => d.artist.gender === g).length;
  return (
    <main id="main" className="wrap page page-wall">
      <h1 className="sr-only">{SITE_TITLE}</h1>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldJson([{ "@type": "WebSite", "@id": `${CANONICAL_ORIGIN}/#website`, name: SITE_NAME, url: `${CANONICAL_ORIGIN}/`, inLanguage: "zh-Hant-TW" }]) }}
      />
      <HomeTagline />
      <div className={songsShown.length ? "home-top" : "home-top is-solo"} data-testid="home-top">
        {songsShown.length ? <HomePick songs={songsShown} /> : null}
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
