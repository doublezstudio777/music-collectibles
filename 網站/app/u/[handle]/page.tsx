import Link from "next/link";
import { notFound } from "next/navigation";
import { userByHandle } from "@/lib/server/auth";
import { publicHoldings } from "@/lib/server/me";
import { pageData } from "@/lib/server/viewer";
import { SelfOnly } from "@/components/self-only";
import { FollowList } from "@/components/follow-list";
import { HoldingsList } from "@/components/holdings-list";
import { SaleWall } from "@/components/sale-wall";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ handle: string }> };

/** 個人頁的人：D1 的帳號 */
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
  return null;
}

export async function generateMetadata({ params }: Props) {
  const u = await loadUser((await params).handle);
  return { title: u ? u.name : "找不到使用者" };
}

export default async function UserPage({ params }: Props) {
  const user = await loadUser((await params).handle);
  if (!user) notFound();
  const { c } = await pageData();
  const own = c.shares.filter((s) => s.author === user.handle).map(c.toShareView);
  // 我有／想要的版本：別人看用伺服器給的清單；本人看時按鈕即時變，所以把全部版本的列都給
  const catalog = c.holdingViews(c.seriesList.flatMap((w) => w.items.flatMap((it) => it.versions.map((v) => `${w.artistSlug}/${w.no}#${it.id}-${v.id}`))));

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
            <Link className="btn btn-line" href="/settings">
              設定
            </Link>
          </div>
        </SelfOnly>
      </header>

      <section className="block">
        <h2 className="block-title">炫收藏</h2>
        <ShareWall
          shares={own}
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

      <SaleWall shares={own} />

      <SelfOnly handle={user.handle}>
        <FollowList artists={c.artists.map((a) => ({ slug: a.slug, name: a.name, tagline: a.tagline }))} />
      </SelfOnly>

      <HoldingsList handle={user.handle} owned={user.owned} wanted={user.wanted} catalog={catalog} />
    </main>
  );
}
