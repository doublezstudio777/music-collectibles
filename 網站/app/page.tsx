import { allShareViews } from "@/lib/data";
import { ShareWall } from "@/components/share-wall";

export default function Home() {
  return (
    <main className="wrap page page-wall">
      <h1 className="sr-only">音藏｜樂迷的收藏分享</h1>
      <ShareWall shares={allShareViews()} scope={{ all: true }} sortable />
    </main>
  );
}
