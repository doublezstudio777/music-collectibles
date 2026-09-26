import Link from "next/link";
import { notFound } from "next/navigation";
import { allHoldingViews, CURRENT_USER, getUser, shares, toShareView } from "@/lib/data";
import { HoldingsList } from "@/components/holdings-list";
import { NextPhase } from "@/components/next-phase";
import { SaleWall } from "@/components/sale-wall";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props) {
  const u = getUser((await params).handle);
  return { title: u ? u.name : "找不到使用者" };
}

export default async function UserPage({ params }: Props) {
  const user = getUser((await params).handle);
  if (!user) notFound();
  const isSelf = user.handle === CURRENT_USER;
  const own = shares.filter((s) => s.author === user.handle).map(toShareView);

  return (
    <main className="wrap page">
      <header className="profile">
        <span className="ava ava-lg" aria-hidden="true">
          {user.initials}
        </span>
        <div className="profile-text">
          <h1 className="page-title">{user.name}</h1>
          <p className="page-meta">{user.bio}</p>
        </div>
        {isSelf ? (
          <div className="head-actions">
            <Link className="btn btn-line" href="/me/likes">
              喜愛清單
            </Link>
            <NextPhase label="編輯簡介" />
          </div>
        ) : null}
      </header>

      <section className="block">
        <h2 className="block-title">炫收藏</h2>
        <ShareWall
          shares={own}
          scope={{ author: user.handle }}
          empty={
            <p className="empty">
              還沒有炫過收藏
              {isSelf ? (
                <Link className="btn btn-p empty-btn" href="/share/new">
                  炫收藏
                </Link>
              ) : null}
            </p>
          }
        />
      </section>

      <SaleWall shares={own} scopeAuthor={user.handle} />

      <HoldingsList isSelf={isSelf} owned={user.owned} wanted={user.wanted} catalog={allHoldingViews()} />
    </main>
  );
}
