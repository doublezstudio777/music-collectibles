import { pageData } from "@/lib/server/viewer";
import { LikesWall } from "@/components/likes-wall";

export const metadata = { title: "喜愛清單" };

export default async function LikesPage() {
  const { c } = await pageData();
  return (
    <main className="wrap page">
      <header className="page-head">
        <h1 className="page-title">喜愛清單</h1>
      </header>
      <LikesWall all={c.allShareViews()} />
    </main>
  );
}
