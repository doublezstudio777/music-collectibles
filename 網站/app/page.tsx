import { pageData } from "@/lib/server/viewer";
import { ShareWall, type WallFilter, type WallSort } from "@/components/share-wall";
import { HomeTagline } from "@/components/home-tagline";
import { ArtistRow } from "@/components/artist-faces";
import { SITE_TITLE } from "@/lib/data";

type Props = { searchParams: Promise<{ state?: string; sort?: string; page?: string }> };

export default async function Home({ searchParams }: Props) {
  const q = await searchParams;
  const filter: WallFilter = q.state === "selling" || q.state === "sale" || q.state === "offer" ? "selling" : "all";
  const sort: WallSort = q.sort === "likes" ? "likes" : q.sort === "new" ? "new" : "following";
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const { c } = await pageData();
  return (
    <main className="wrap page page-wall">
      <h1 className="sr-only">{SITE_TITLE}</h1>
      <HomeTagline />
      {/* 伺服器最多給 60 位（依收藏數），瀏覽器端把已追蹤的移到前面再取一排 */}
      <ArtistRow faces={c.artistFaces().slice(0, 60)} />
      <ShareWall shares={c.allShareViews()} sortable paged filter={filter} initialSort={sort} page={page} />
    </main>
  );
}
