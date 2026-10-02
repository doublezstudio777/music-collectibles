import Link from "@/components/link";
import { notFound } from "next/navigation";
import { avatarUrl, userByHandle } from "@/lib/server/auth";
import { Ava } from "@/components/ava";
import { ReportBox } from "@/components/report";
import { NotSelf } from "@/components/self-only";
import { artistHref, avatarTarget } from "@/lib/data";
import { publicHoldings } from "@/lib/server/me";
import { regionNames } from "@/lib/server/geo";
import { pageData } from "@/lib/server/viewer";
import { SelfOnly } from "@/components/self-only";
import { LevelTag } from "@/components/level-tag";
import { profileScore } from "@/lib/server/scores";
import { levelOf } from "@/lib/levels";
import { FollowList } from "@/components/follow-list";
import { GuideButton } from "@/components/guide-button";
import { monthRank } from "@/lib/server/rankings";
import { HoldingsList } from "@/components/holdings-list";
import { SaleWall } from "@/components/sale-wall";
import { ShareWall } from "@/components/share-wall";
import { SocialIcons } from "@/components/social-icons";
import { DmButton } from "@/components/dm-button";
import { parseFavs, parseLinks, type Links } from "@/lib/profile-rules";

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
      links: {} as Links,
      favs: [] as string[],
      verified: false,
      region: "",
      score: null,
      monthRank: null,
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
      links: parseLinks(u.links),
      favs: parseFavs(u.favArtists),
      verified: Boolean(u.emailVerifiedAt),
      region: (await regionNames([u.id])).get(u.id) ?? "",
      score: await profileScore(u),
      monthRank: await monthRank(u.id),
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
          {/* 2026-10-02 建議 13：固定兩行，手機不會在「分」前面斷行 */}
          目前 <b className="num" data-testid="score-now">{s.score.toLocaleString("en-US")}</b> 分
          {s.level.next === null ? (
            s.level.level === 25 ? <span className="score-next">已是最高等級</span> : null
          ) : (
            <span className="score-next" data-testid="score-next">
              離 {levelOf(s.level.next).label} 還差 <span className="num">{s.level.toNext.toLocaleString("en-US")}</span> 分
            </span>
          )}
        </p>
      )}
      {s.admin ? null : (
        <p className="score-at" data-testid="score-at">
          {s.runAt ? `每天統計一次，上次 ${twTime(s.runAt)}` : "分數尚未統計"}
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
  // 最喜歡的藝人：照本人排的順序，已隱藏、刪除或前台看不到藝人頁的不顯示
  const favs = user.favs.map((slug) => c.visibleArtist(slug)).filter((a) => a !== undefined);
  const own = c.shares.filter((s) => s.author === user.handle).map(c.toShareView);
  const notSelling = own.filter((s) => !((s.sale.state === "sale" || s.sale.state === "offer") && !s.lock));
  // 我有／想要：伺服器只算這位會員目前標的那些（2026-10-01 起不再把全站版本都給，本人剛勾的由前端另外補）
  const views = c.holdingViews(Array.from(new Set([...user.owned, ...user.wanted])));

  return (
    <main id="main" className="wrap page">
      <header className="profile">
        <div className="profile-ava">
          <Ava name={user.name} src={user.avatar} size="lg" />
        </div>
        <div className="profile-text">
          <h1 className="page-title">
            {user.name}
            {user.verified ? <span className="verified">已認證</span> : null}
            {user.score ? <LevelTag badge={user.score.badge} /> : null}
          </h1>
          {user.score ? <ScoreLine handle={user.handle} s={user.score} /> : null}
          {user.monthRank ? (
            <p className="page-meta" data-testid="profile-month-rank">
              <Link className="link" href="/ranking#month">
                本月第 {user.monthRank} 名
              </Link>
            </p>
          ) : null}
          {user.region ? (
            <p className="page-meta" data-testid="profile-region">
              所在地區 {user.region}
            </p>
          ) : null}
          {user.bio ? (
            <p className="profile-bio" data-testid="profile-bio">
              {user.bio}
            </p>
          ) : null}
          {favs.length ? (
            <p className="fav-tags" data-testid="profile-favs">
              <span className="fav-tags-label">最喜歡的藝人</span>
              {favs.map((a) => (
                <Link key={a.slug} className="fav-tag" href={artistHref(a.slug)} data-slug={a.slug}>
                  {a.name}
                </Link>
              ))}
            </p>
          ) : null}
          <SocialIcons links={user.links} />
        </div>
        {user.deleted ? null : (
          <NotSelf handle={user.handle}>
            <div className="head-actions">
              <DmButton to={{ user: user.handle }} label="傳訊息" testid="dm-user" />
            </div>
          </NotSelf>
        )}
        <SelfOnly handle={user.handle}>
          <div className="head-actions">
            <Link className="btn btn-line" href="/settings" data-testid="edit-profile">
              編輯個人資料
            </Link>
            <Link className="btn btn-line" href="/me/likes">
              願望清單
            </Link>
            <GuideButton />
          </div>
        </SelfOnly>
      </header>

      {/* 2026-10-02 建議 14：出售中排在炫收藏前面（DESIGN「我的頁面」段），炫收藏只列不在賣的，同一張卡不出現兩次 */}
      {user.deleted ? null : <SaleWall shares={own} />}
      {own.length === 0 || notSelling.length ? (
        <section className="block">
          <h2 className="block-title">炫收藏</h2>
          <ShareWall
            shares={notSelling}
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
      ) : null}

      {user.deleted ? null : (
        <>

          <SelfOnly handle={user.handle}>
            <FollowList artists={c.artists.map((a) => ({ slug: a.slug, name: a.name, tagline: a.tagline }))} />
          </SelfOnly>

          <HoldingsList handle={user.handle} name={user.name} owned={user.owned} wanted={user.wanted} views={views} />
        </>
      )}
      {/* 檢舉大頭貼放頁底，跟收藏頁「對這則收藏有疑問嗎？」同一個位置（2026-10-02 建議 14） */}
      {user.avatarId && !user.deleted ? (
        <NotSelf handle={user.handle}>
          <div className="profile-report" data-testid="profile-report">
            <ReportBox target={avatarTarget(user.avatarId)} label="檢舉這位會員的大頭貼" />
          </div>
        </NotSelf>
      ) : null}
    </main>
  );
}
