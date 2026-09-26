import { allShareViews } from "@/lib/data";
import { ShareWall, type WallFilter } from "@/components/share-wall";

type Props = { searchParams: Promise<{ state?: string; page?: string }> };

export default async function Home({ searchParams }: Props) {
  const q = await searchParams;
  const filter: WallFilter = q.state === "sale" || q.state === "offer" ? q.state : "all";
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  return (
    <main className="wrap page page-wall">
      <h1 className="sr-only">音藏｜樂迷的收藏分享</h1>
      <ShareWall shares={allShareViews()} scope={{ all: true }} sortable paged filter={filter} page={page} />
    </main>
  );
}
