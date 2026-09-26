import { pageData } from "@/lib/server/viewer";
import { ShareWall, type WallFilter, type WallSort } from "@/components/share-wall";

type Props = { searchParams: Promise<{ state?: string; sort?: string; page?: string }> };

export default async function Home({ searchParams }: Props) {
  const q = await searchParams;
  const filter: WallFilter = q.state === "selling" || q.state === "sale" || q.state === "offer" ? "selling" : "all";
  const sort: WallSort = q.sort === "likes" ? "likes" : q.sort === "new" ? "new" : "following";
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const { c } = await pageData();
  return (
    <main className="wrap page page-wall">
      <h1 className="sr-only">音藏｜樂迷的收藏分享</h1>
      <ShareWall shares={c.allShareViews()} hot={c.hotArtists()} sortable paged filter={filter} initialSort={sort} page={page} />
    </main>
  );
}
