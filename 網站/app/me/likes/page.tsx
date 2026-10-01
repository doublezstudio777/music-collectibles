import { pageData } from "@/lib/server/viewer";
import { WishList } from "@/components/wish-list";

export const metadata = { title: "願望清單" };

type Props = { searchParams?: Promise<{ tab?: string }> };

/** 願望清單（2026-10-01 統一）：想要的專輯／版本、喜歡的收藏兩個分頁（components/wish-list.tsx） */
export default async function LikesPage({ searchParams }: Props) {
  const { c } = await pageData();
  const tab = (await searchParams)?.tab === "shares" ? "shares" : "versions";
  return (
    <main className="wrap page">
      <header className="page-head">
        <h1 className="page-title">願望清單</h1>
      </header>
      <WishList all={c.allShareViews()} initialTab={tab} />
    </main>
  );
}
