import Link from "@/components/link";
import { Ava } from "@/components/ava";
import { LevelTag } from "@/components/level-tag";
import { rankingBoards, type RankRow } from "@/lib/server/rankings";

export const metadata = { title: "收藏榮譽榜" };

function Rows({ list, testid, artist = false }: { list: RankRow[]; testid: string; artist?: boolean }) {
  return (
    <ol className="rank-list" data-testid={testid}>
      {list.map((r) => (
        <li key={`${r.pos}-${r.handle}`} className="rank-row" data-handle={r.handle} data-points={r.points}>
          <span className="rank-pos num">{artist ? null : r.pos}</span>
          {artist && r.artist ? (
            <Link className="link rank-artist" href={`/artist/${r.artist.slug}`}>
              {r.artist.name}
            </Link>
          ) : null}
          <Link className="rank-who" href={`/u/${r.handle}`}>
            <Ava name={r.name} src={r.avatar} />
            <span className="rank-name">{r.name}</span>
          </Link>
          <LevelTag badge={r.badge} />
          <span className="rank-pts num">{r.points.toLocaleString("en-US")} 分</span>
        </li>
      ))}
    </ol>
  );
}

export default async function RankingPage() {
  const b = await rankingBoards();
  const month = b.period ? `${Number(b.period.slice(0, 4))} 年 ${Number(b.period.slice(5, 7))} 月` : "";
  const any = b.month || b.total || b.fakebuster || b.topfan;
  return (
    <main id="main" className="wrap page page-narrow">
      <h1 className="page-title">收藏榮譽榜</h1>
      {b.month ? (
        <section id="month" className="block">
          <h2 className="block-title">
            本月貢獻榜<span className="sub rank-period">{month}</span>
          </h2>
          <Rows list={b.month} testid="rank-month" />
        </section>
      ) : null}
      {b.total ? (
        <section id="total" className="block">
          <h2 className="block-title">總榜</h2>
          <Rows list={b.total} testid="rank-total" />
        </section>
      ) : null}
      {b.fakebuster ? (
        <section id="fakebuster" className="block">
          <h2 className="block-title">打假先鋒</h2>
          <Rows list={b.fakebuster} testid="rank-fakebuster" />
        </section>
      ) : null}
      {b.topfan ? (
        <section id="topfan" className="block">
          <h2 className="block-title">頭號樂迷</h2>
          <Rows list={b.topfan} testid="rank-topfan" artist />
        </section>
      ) : null}
      {any ? null : (
        <p className="empty" data-testid="rank-empty">
          目前還沒有榜單。分數每天凌晨統計，有人拿到分數後，本月貢獻榜與總榜就會出現。
        </p>
      )}
    </main>
  );
}
