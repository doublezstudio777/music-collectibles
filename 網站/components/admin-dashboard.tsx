"use client";

import Link from "@/components/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { DayPoint, Stats } from "@/lib/server/stats";

type Queue = {
  pending: number;
  reports: number;
  appeals: number;
  locked: number;
  hidden: number;
  comments?: number;
  commentsHidden?: number;
  duplicates?: number;
  avatars?: number;
  deletions?: number;
  artistPhotos?: number;
  errorReports?: number;
  feedback?: number;
  takedowns?: number;
};
type StatsRes = { stats: Stats; cached: boolean; queue: Queue };
type Usage = {
  r2: { used: number; limit: number; free: number };
  reads: { month: number; stopAt: number; free: number };
  paused: { on: boolean; at: string | null; reason: string };
  free: { workersRequestsPerDay: number; workersCpuMs: number; d1RowsReadPerDay: number; d1RowsWrittenPerDay: number; r2ClassAPerMonth: number };
  cloudflare:
    | { configured: false; need: string }
    | { configured: true; ok: false; message: string }
    | {
        configured: true;
        ok: true;
        workers: { date: string; requests: number; errors: number; exceeded: number; cpuP50: number; cpuP90: number }[];
        d1Today: { rowsRead: number; rowsWritten: number };
        r2Month: { classA: number; classB: number };
        at: string;
      };
};

const n = (x: number) => x.toLocaleString("en-US");
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 1000) / 10 : 0}%`;
const tw = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

function Tile({ label, value, sub, testid }: { label: string; value: string; sub?: string; testid?: string }) {
  // 金額：幣別與數字分開，放不下時在兩者之間換行；字多時縮小一級。不截斷
  const m = value.match(/^(NT\$)(.+)$/);
  return (
    <div className="stat" data-testid={testid}>
      <span className="stat-label">{label}</span>
      <b className={`stat-value num${value.length > 8 ? " stat-value-long" : ""}`}>
        {m ? (
          <>
            <span>{m[1]}</span>
            <span>{m[2]}</span>
          </>
        ) : (
          value
        )}
      </b>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

/** 30 天趨勢：單一數列的小圖，一張圖一個量（不做雙軸）。滑過顯示當天數字 */
function Spark({ title, points, get, money = false }: { title: string; points: DayPoint[]; get: (p: DayPoint) => number; money?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const H = 90;
  const pad = { l: 4, r: 4, t: 8, b: 16 };
  const vals = points.map(get);
  const max = Math.max(1, ...vals);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = vals[vals.length - 1] ?? 0;
  const total = vals.reduce((a, b) => a + b, 0);
  const h = hover ?? vals.length - 1;
  const fmt = (v: number) => (money ? `NT$${n(v)}` : n(v));
  return (
    <figure className="spark" data-testid="spark">
      <figcaption>
        <span>{title}</span>
        <b className="num">{hover === null ? fmt(title.startsWith("累計") ? last : total) : fmt(vals[h])}</b>
        <span className="sub">{hover === null ? (title.startsWith("累計") ? "目前" : "30 天合計") : points[h].day}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}，最近 30 天`} onMouseLeave={() => setHover(null)}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="spark-base" />
        <path d={d} className="spark-line" />
        {hover !== null ? (
          <>
            <line x1={x(h)} x2={x(h)} y1={pad.t} y2={H - pad.b} className="spark-cross" />
            <circle cx={x(h)} cy={y(vals[h])} r={4} className="spark-dot" />
          </>
        ) : null}
        <text x={pad.l} y={H - 3} className="spark-axis">
          {points[0]?.day.slice(5)}
        </text>
        <text x={W - pad.r} y={H - 3} textAnchor="end" className="spark-axis">
          {points[points.length - 1]?.day.slice(5)}
        </text>
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={x(i) - (W - pad.l - pad.r) / points.length / 2}
            y={0}
            width={(W - pad.l - pad.r) / points.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
    </figure>
  );
}

const TREND: { title: string; get: (p: DayPoint) => number; money?: boolean }[] = [
  { title: "新註冊", get: (p) => p.users },
  { title: "累計會員", get: (p) => p.members },
  { title: "活躍人數", get: (p) => p.active },
  { title: "新炫收藏", get: (p) => p.shares },
  { title: "新照片", get: (p) => p.photos },
  { title: "出價", get: (p) => p.offers },
  { title: "成交", get: (p) => p.deals },
  { title: "成交金額", get: (p) => p.amount, money: true },
];

function Meter({ label, used, limit, text, testid }: { label: string; used: number; limit: number; text: string; testid?: string }) {
  const r = Math.min(1, limit ? used / limit : 0);
  return (
    <div className="meter" data-testid={testid}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="num">{text}</span>
      </div>
      <span className="meter-bar" aria-hidden="true">
        <span style={{ width: `${(r * 100).toFixed(1)}%` }} className={r >= 0.8 ? "is-high" : undefined} />
      </span>
    </div>
  );
}

function UsageBlock({ u }: { u: Usage }) {
  const cf = u.cloudflare;
  return (
    <section className="block" data-testid="usage">
      <h2 className="block-title">用量與花費</h2>
      <div className="meters">
        <Meter label="照片容量（上限 8 GB，免費 10 GB）" used={u.r2.used} limit={u.r2.limit} text={`${gb(u.r2.used)} / ${gb(u.r2.limit)}（${pct(u.r2.used, u.r2.limit)}）`} testid="usage-r2" />
        <Meter
          label="本月照片讀取（免費 1,000 萬次，到門檻改顯示佔位圖）"
          used={u.reads.month}
          limit={u.reads.stopAt}
          text={`${n(u.reads.month)} / ${n(u.reads.stopAt)}`}
          testid="usage-reads"
        />
      </div>
      <p className="usage-line" data-testid="usage-paused">
        暫停模式：{u.paused.on ? <b className="flag flag-lock">暫停中</b> : "正常"}
        {u.paused.on && u.paused.at ? `（${tw(u.paused.at)} · ${u.paused.reason}）` : ""}
      </p>
      <h3 className="sub-title">Cloudflare 用量</h3>
      {!cf.configured ? (
        <p className="usage-line" data-testid="cf-unset">
          <b>未設定</b>　{cf.need}
        </p>
      ) : !cf.ok ? (
        <p className="usage-line" role="alert">
          {cf.message}
        </p>
      ) : (
        <>
          <div className="tbl-scroll">
            <table className="tbl" data-testid="cf-workers">
              <thead>
                <tr>
                  <th>日期（UTC）</th>
                  <th className="num">請求</th>
                  <th className="num">錯誤</th>
                  <th className="num">超過 CPU</th>
                  <th className="num">CPU p50</th>
                  <th className="num">CPU p90</th>
                </tr>
              </thead>
              <tbody>
                {cf.workers.map((w) => (
                  <tr key={w.date}>
                    <td>{w.date}</td>
                    <td className="num">
                      {n(w.requests)}
                      <span className="sub"> / {n(u.free.workersRequestsPerDay)}</span>
                    </td>
                    <td className="num">{n(w.errors)}</td>
                    <td className="num">{n(w.exceeded)}</td>
                    <td className="num">{w.cpuP50} ms</td>
                    <td className="num">{w.cpuP90} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="usage-line">
            D1 今天讀 {n(cf.d1Today.rowsRead)} / {n(u.free.d1RowsReadPerDay)} 列、寫 {n(cf.d1Today.rowsWritten)} / {n(u.free.d1RowsWrittenPerDay)} 列；
            R2 本月寫入類操作 {n(cf.r2Month.classA)} / {n(u.free.r2ClassAPerMonth)}、讀取類 {n(cf.r2Month.classB)}。CPU 為各狀態請求數加權的近似值，
            免費方案每個請求上限 {u.free.workersCpuMs} ms。資料時間 {tw(cf.at)}
          </p>
        </>
      )}
    </section>
  );
}

export function AdminDashboard() {
  const [d, setD] = useState<StatsRes | null>(null);
  const [u, setU] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchAll = (fresh: boolean) =>
    Promise.all([api<StatsRes>(`/api/admin/stats${fresh ? "?fresh=1" : ""}`), api<Usage>("/api/admin/usage")]);
  const apply = ([a, b]: Awaited<ReturnType<typeof fetchAll>>) => {
    setBusy(false);
    if (a.ok) setD(a.data);
    else setError(a.error.message);
    if (b.ok) setU(b.data);
  };
  const load = (fresh: boolean) => {
    setBusy(true);
    void fetchAll(fresh).then(apply);
  };
  useEffect(() => {
    let alive = true;
    void Promise.all([api<StatsRes>("/api/admin/stats"), api<Usage>("/api/admin/usage")]).then(([a, b]) => {
      if (!alive) return;
      if (a.ok) setD(a.data);
      else setError(a.error.message);
      if (b.ok) setU(b.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="empty">{error}</p>;
  if (!d) return <p className="empty">讀取中</p>;
  const { stats: s, queue: q } = d;
  const regionTotal = s.regions.reduce((a, r) => a + r.n, 0);

  return (
    <div className="dash" data-testid="dashboard">
      <p className="dash-meta">
        統計時間 {tw(s.at)}
        {d.cached ? "（10 分鐘內的快取）" : ""}
        <button type="button" className="btn btn-text" disabled={busy} onClick={() => load(true)} data-testid="refresh">
          重新計算
        </button>
      </p>

      <section className="block">
        <h2 className="block-title">待處理</h2>
        <div className="queue" data-testid="queue">
          {/* 2026-10-02 之後再說 7：非 0 的加黑框排前面，0 的淡掉 */}
          {(
            [
            { href: "/admin/moderation#pending", testid: undefined, n: q.pending, label: <>待審核新增</> },
            { href: "/admin/moderation#reports", testid: undefined, n: q.reports, label: <>待裁決檢舉</> },
            { href: "/admin/error-reports", testid: "queue-error-reports", n: q.errorReports ?? 0, label: <>錯誤回報</> },
            { href: "/admin/feedback", testid: "queue-feedback", n: q.feedback ?? 0, label: <>未處理的意見回饋</> },
            { href: "/admin/moderation#appeals", testid: undefined, n: q.appeals, label: <>待處理申訴</> },
            { href: "/admin/moderation#reports", testid: undefined, n: q.locked, label: <>被鎖定的內容</> },
            { href: "/admin/moderation#hidden", testid: undefined, n: q.hidden, label: <>已下架</> },
            { href: "/admin/moderation#comments", testid: "queue-comments", n: q.comments ?? 0, label: <>被檢舉的留言{q.commentsHidden ? `（${q.commentsHidden} 則已自動隱藏）` : ""}</> },
            { href: "/admin/duplicates", testid: "queue-duplicates", n: q.duplicates ?? 0, label: <>疑似重複藝人</> },
            { href: "/admin/moderation#avatars", testid: "queue-avatars", n: q.avatars ?? 0, label: <>被檢舉的大頭貼</> },
            { href: "/admin/deletions", testid: "queue-deletions", n: q.deletions ?? 0, label: <>刪帳申請</> },
            { href: "/admin/takedowns", testid: "queue-takedowns", n: q.takedowns ?? 0, label: <>侵權通知</> },
            { href: "/admin/artist-photos", testid: "queue-artist-photos", n: q.artistPhotos ?? 0, label: <>藝人照片投稿</> },
            ] as { href: string; testid?: string; n: number; label: React.ReactNode }[]
          )
            .map((x, i) => ({ ...x, i }))
            .sort((a, b) => (b.n > 0 ? 1 : 0) - (a.n > 0 ? 1 : 0) || a.i - b.i)
            .map((x) => (
              <Link key={x.href + x.i} href={x.href} className={x.n > 0 ? "queue-item has-n" : "queue-item is-zero"} data-testid={x.testid} data-n={x.n}>
                <b className="num">{x.n}</b>
                <span>{x.label}</span>
              </Link>
            ))}
        </div>
      </section>

      <section className="block">
        <h2 className="block-title">會員</h2>
        <div className="stats" data-testid="stats-members">
          <Tile label="總會員" value={n(s.members.total)} sub={`已驗證 ${n(s.members.verified)}・停權 ${n(s.members.suspended)}`} testid="st-total" />
          <Tile label="今日新註冊" value={n(s.members.today)} testid="st-today" />
          <Tile label="本週新註冊" value={n(s.members.week)} sub="週一起算" testid="st-week" />
          <Tile label="本月新註冊" value={n(s.members.month)} testid="st-month" />
          <Tile label="7 天活躍" value={n(s.members.active7)} testid="st-a7" />
          <Tile label="30 天活躍" value={n(s.members.active30)} testid="st-a30" />
        </div>
        <h3 className="sub-title">所在地區</h3>
        <ul className="regions" data-testid="regions">
          {s.regions.map((r) => (
            <li key={r.code}>
              <span className="region-name">{r.name}</span>
              <span className="region-bar" aria-hidden="true">
                <span style={{ width: `${regionTotal ? (r.n / regionTotal) * 100 : 0}%` }} />
              </span>
              <span className="num">
                {n(r.n)}（{pct(r.n, regionTotal)}）
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2 className="block-title">內容與交易</h2>
        <div className="stats" data-testid="stats-content">
          <Tile label="炫收藏" value={n(s.content.shares)} sub={`本週 +${n(s.content.sharesWeek)}・下架中 ${n(s.content.hiddenShares)}`} testid="st-shares" />
          <Tile label="照片" value={n(s.content.photos)} sub={`本週 +${n(s.content.photosWeek)}`} testid="st-photos" />
          {s.comments ? (
            <Tile
              label="留言"
              value={n(s.comments.total)}
              sub={`今日 +${n(s.comments.today)}・本週 +${n(s.comments.week)}・被檢舉 ${n(s.comments.reported)}・隱藏中 ${n(s.comments.hidden)}`}
              testid="st-comments"
            />
          ) : null}
          <Tile label="出價" value={n(s.trade.offers)} testid="st-offers" />
          <Tile label="成交" value={n(s.trade.deals)} testid="st-deals" />
          <Tile label="成交總金額" value={`NT$${n(s.trade.amount)}`} testid="st-amount" />
        </div>
      </section>

      <section className="block">
        <h2 className="block-title">最近 30 天</h2>
        <div className="sparks">
          {TREND.map((t) => (
            <Spark key={t.title} title={t.title} points={s.trend} get={t.get} money={t.money} />
          ))}
        </div>
        <details className="trend-table">
          <summary>看數字表</summary>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>日期</th>
                  {TREND.map((t) => (
                    <th key={t.title} className="num">
                      {t.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.trend.map((p) => (
                  <tr key={p.day}>
                    <td>{p.day}</td>
                    {TREND.map((t) => (
                      <td key={t.title} className="num">
                        {n(t.get(p))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {u ? <UsageBlock u={u} /> : null}
    </div>
  );
}
