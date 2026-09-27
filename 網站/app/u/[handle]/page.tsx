import Link from "next/link";
import { notFound } from "next/navigation";
import { avatarUrl, userByHandle } from "@/lib/server/auth";
import { Ava } from "@/components/ava";
import { ReportBox } from "@/components/report";
import { NotSelf } from "@/components/self-only";
import { avatarTarget } from "@/lib/data";
import { publicHoldings } from "@/lib/server/me";
import { regionNames } from "@/lib/server/geo";
import { pageData } from "@/lib/server/viewer";
import { SelfOnly } from "@/components/self-only";
import { LevelTag } from "@/components/level-tag";
import { profileScore } from "@/lib/server/scores";
import { levelOf } from "@/lib/levels";
import { FollowList } from "@/components/follow-list";
import { HoldingsList } from "@/components/holdings-list";
import { SaleWall } from "@/components/sale-wall";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ handle: string }> };

/** 個人頁的人：D1 的帳號 */
async function loadUser(handle: string) {
  const h = handle.toLowerCase();
  const u = await userByHandle(h);
  // 已刪除的會員（2026-09-28）：只留暱稱「已刪除的會員」與他的炫收藏，其他個人資訊一律不顯示
  if (u && u.status === "deleted") {
    return {
      deleted: true as const,
      handle: u.handle,
      name: u.name,
      avatar: null,
      avatarId: "",
      bio: "",
      verified: false,
      region: "",
      score: null,
      owned: [],
      wanted: [],
    };
  }
  if (u && u.status === "active") {
    return {
      deleted: false as const,
      handle: u.handle,
      name: u.name,
      avatar: avatarUrl(u.avatarKey),
      // 檢舉大頭貼用：v/{照片 id}.webp → 照片 id
      avatarId: u.avatarKey ? u.avatarKey.slice(2).replace(/\.[a-z]+$/, "") : "",
      bio: u.bio,
      verified: Boolean(u.emailVerifiedAt),
      region: (await regionNames([u.id])).get(u.id) ?? "",
      score: await profileScore(u),
      ...(await publicHoldings(u.id)),
    };
  }
  return null;
}

export async function generateMetadata({ params }: Props) {
  const u = await loadUser((await params).handle);
  return { title: u ? u.name : "找不到使用者" };
}

/** 台灣時間「2026-09-28 02:00」 */
const twTime = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

function ScoreLine({ handle, s }: { handle: string; s: Awaited<ReturnType<typeof profileScore>> }) {
  return (
    <div className="score-box" data-testid="profile-score">
      {s.admin ? null : (
        <p className="page-meta">
          目前 <b className="num" data-testid="score-now">{s.score.toLocaleString("en-US")}</b> 分
          {s.level.next === null && s.level.level < 25 ? null : (
            <span className="dot" aria-hidden="true">·</span>
          )}
          {s.level.next === null ? (
            s.level.level === 25 ? "已是最高等級" : null
          ) : (
            <span data-testid="score-next">
              離 {levelOf(s.level.next).label} 還差 <span className="num">{s.level.toNext.toLocaleString("en-US")}</span> 分
            </span>
          )}
        </p>
      )}
      {s.admin ? null : (
        <p className="score-at" data-testid="score-at">
          {s.runAt ? `分數統計於 ${twTime(s.runAt)}（每天統計一次）` : "分數尚未統計"}
        </p>
      )}
      {!s.admin && s.pending > 0 ? (
        <SelfOnly handle={handle}>
          <p className="page-meta" data-testid="score-pending">
            另有 {s.pending.toLocaleString("en-US")} 分待入帳（編輯頁面、補資料、檢舉成立 7 天後入帳）
          </p>
        </SelfOnly>
      ) : null}
      {s.titles.length ? (
        <p className="title-list" data-testid="profile-titles">
          {s.titles.map((t) =>
            t.href ? (
              <Link key={t.label} className="title-chip" href={t.href}>
                {t.label}
              </Link>
            ) : (
              <span key={t.label} className="title-chip">
                {t.label}
              </span>
            ),
          )}
        </p>
      ) : null}
    </div>
  );
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
        <div className="profile-ava">
          <Ava name={user.name} src={user.avatar} size="lg" />
          {user.avatarId ? (
            <NotSelf handle={user.handle}>
              <ReportBox target={avatarTarget(user.avatarId)} label="檢舉大頭貼" />
            </NotSelf>
          ) : null}
        </div>
        <div className="profile-text">
          <h1 className="page-title">
            {user.name}
            {user.verified ? <span className="verified">已認證</span> : null}
            {user.score ? <LevelTag badge={user.score.badge} /> : null}
          </h1>
          {user.score ? <ScoreLine handle={user.handle} s={user.score} /> : null}
          {user.region ? (
            <p className="page-meta" data-testid="profile-region">
              所在地區 {user.region}
            </p>
          ) : null}
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

      {user.deleted ? null : (
        <>
          <SaleWall shares={own} />

          <SelfOnly handle={user.handle}>
            <FollowList artists={c.artists.map((a) => ({ slug: a.slug, name: a.name, tagline: a.tagline }))} />
          </SelfOnly>

          <HoldingsList handle={user.handle} owned={user.owned} wanted={user.wanted} catalog={catalog} />
        </>
      )}
    </main>
  );
}
