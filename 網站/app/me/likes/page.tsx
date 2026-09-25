import { allShareViews } from "@/lib/data";
import { LikesWall } from "@/components/likes-wall";

export const metadata = { title: "喜愛清單" };

export default function LikesPage() {
  return (
    <main className="wrap page">
      <header className="page-head">
        <h1 className="page-title">喜愛清單</h1>
      </header>
      <LikesWall all={allShareViews()} />
    </main>
  );
}
