import Link from "next/link";
import { notFound } from "next/navigation";
import { allHoldingViews, getUser, shares, toShareView } from "@/lib/data";
import { userByHandle } from "@/lib/server/auth";
import { publicHoldings } from "@/lib/server/me";
import { SelfOnly } from "@/components/self-only";
import { FollowList } from "@/components/follow-list";
import { HoldingsList } from "@/components/holdings-list";
import { NextPhase } from "@/components/next-phase";
import { SaleWall } from "@/components/sale-wall";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ handle: string }> };

/**
 * 個人頁的人：先找 D1 的帳號（含本機 seed 進去的示範帳號），找不到再退回 data.ts 的示範資料
 * （示範炫收藏的作者在正式資料庫裡不會有帳號）。
 */
async function loadUser(handle: string) {
  const h = handle.toLowerCase();
  const u = await userByHandle(h);
  if (u && u.status === "active") {
    return {
      handle: u.handle,
      name: u.name,
      initials: Array.from(u.name)[0] ?? "?",
      bio: u.bio,
      verified: Boolean(u.emailVerifiedAt),
      ...(await publicHoldings(u.id)),
    };
  }
  return getUser(h) ?? null;
}

export async function generateMetadata({ params }: Props) {
  const u = await loadUser((await params).handle);
  return { title: u ? u.name : "找不到使用者" };
}

export default async function UserPage({ params }: Props) {
  const user = await loadUser((await params).handle);
  if (!user) notFound();
  const own = shares.filter((s) => s.author === user.handle).map(toShareView);

  return (
    <main className="wrap page">
      <header className="profile">
        <span className="ava ava-lg" aria-hidden="true">
          {user.initials}
        </span>
        <div className="profile-text">
          <h1 className="page-title">
            {user.name}
            {user.verified ? <span className="verified">已認證</span> : null}
          </h1>
          {user.bio ? <p className="page-meta">{user.bio}</p> : null}
        </div>
        <SelfOnly handle={user.handle}>
          <div className="head-actions">
            <Link className="btn btn-line" href="/me/likes">
              喜愛清單
            </Link>
            <NextPhase label="編輯簡介" />
          </div>
        </SelfOnly>
      </header>

      <section className="block">
        <h2 className="block-title">炫收藏</h2>
        <ShareWall
          shares={own}
          scope={{ author: user.handle }}
          empty={
            <p className="empty">
              還沒有炫過收藏
              <SelfOnly handle={user.handle}>
                <Link className="btn btn-p empty-btn" href="/share/new">
                  炫收藏
                </Link>
              </SelfOnly>
            </p>
          }
        />
      </section>

      <SaleWall shares={own} scopeAuthor={user.handle} />

      <SelfOnly handle={user.handle}>
        <FollowList />
      </SelfOnly>

      <HoldingsList handle={user.handle} owned={user.owned} wanted={user.wanted} catalog={allHoldingViews()} />
    </main>
  );
}
