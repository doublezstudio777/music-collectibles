// 管理後台儀表板統計（2026-09-28）。
//
// 不能拖慢前台：
// - 只有管理員打開儀表板時才算，前台頁面、API 完全不碰這些查詢
// - 算好的結果放兩層快取 10 分鐘：Worker 記憶體（同一個 isolate）＋ Cache API（同一個資料中心），
//   10 分鐘內重整只讀快取；按「重新計算」（?fresh=1）才重算
// - 查詢全部在一個 D1 batch 裡，一次往返；彙總（COUNT／SUM／GROUP BY）在 D1 做，Worker 只組 JSON
// - 所在地區分布要逐人判定（最近 30 天出現天數最多的國家），在 Worker 算，一樣只在重算時做
//
// 時間口徑（台灣時間）：今日＝今天 00:00 起；本週＝本週一 00:00 起；本月＝本月 1 日 00:00 起。
// 活躍＝最近 7／30 天（UTC 日期）打開過網站的登入者（user_activity）。
// 趨勢：最近 30 天（台灣日期）每天的新註冊、活躍、新炫收藏、新照片、新出價、成交數與成交金額，另有累計會員數。

import { env } from "cloudflare:workers";
import { countryName } from "@/lib/server/geo";

const TTL = 600;
const TZ = 8 * 3600_000;

export type DayPoint = { day: string; users: number; members: number; active: number; shares: number; photos: number; offers: number; deals: number; amount: number };
export type Stats = {
  at: string;
  members: { total: number; today: number; week: number; month: number; verified: number; suspended: number; active7: number; active30: number };
  regions: { code: string; name: string; n: number }[];
  content: { shares: number; sharesWeek: number; hiddenShares: number; photos: number; photosWeek: number };
  trade: { offers: number; deals: number; amount: number };
  trend: DayPoint[];
};

/** 台灣時間某天 00:00 對應的 UTC ISO 字串 */
const twMidnightIso = (twDay: string) => new Date(Date.parse(`${twDay}T00:00:00Z`) - TZ).toISOString();
const twDay = (ms: number) => new Date(ms + TZ).toISOString().slice(0, 10);

export function boundaries(now = Date.now()) {
  const today = twDay(now);
  const d = new Date(`${today}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 週一＝0
  const monday = new Date(d.getTime() - dow * 86400_000).toISOString().slice(0, 10);
  const month = `${today.slice(0, 8)}01`;
  const from30 = twDay(now - 29 * 86400_000);
  return {
    today,
    todayIso: twMidnightIso(today),
    weekIso: twMidnightIso(monday),
    monthIso: twMidnightIso(month),
    from30,
    from30Iso: twMidnightIso(from30),
    utc7: new Date(now - 6 * 86400_000).toISOString().slice(0, 10),
    utc30: new Date(now - 29 * 86400_000).toISOString().slice(0, 10),
  };
}

// 台灣日期的分組鍵：created_at 是 UTC ISO，加 8 小時取日期
const TWD = (col: string) => `substr(datetime(${col}, '+8 hours'), 1, 10)`;

async function compute(): Promise<Stats> {
  const db = env.DB!;
  const b = boundaries();
  const q = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const res = await db.batch([
    q(
      `SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?1), 0) AS today, COALESCE(SUM(created_at >= ?2), 0) AS week,
              COALESCE(SUM(created_at >= ?3), 0) AS month, COALESCE(SUM(email_verified_at IS NOT NULL), 0) AS verified,
              COALESCE(SUM(status = 'suspended'), 0) AS suspended FROM users`,
      b.todayIso, b.weekIso, b.monthIso,
    ),
    q(`SELECT COUNT(DISTINCT CASE WHEN day >= ?1 THEN user_id END) AS a7, COUNT(DISTINCT user_id) AS a30 FROM user_activity WHERE day >= ?2`, b.utc7, b.utc30),
    q(
      `SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?1), 0) AS week, COALESCE(SUM(hidden_at IS NOT NULL), 0) AS hidden FROM shares WHERE deleted_at IS NULL`,
      b.weekIso,
    ),
    q(`SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= ?1), 0) AS week FROM photos WHERE deleted_at IS NULL AND purpose = 'share'`, b.weekIso),
    q(`SELECT COUNT(*) AS n FROM offers`),
    q(`SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS amount FROM deals WHERE voided_at IS NULL`),
    // 趨勢
    q(`SELECT ${TWD("created_at")} AS d, COUNT(*) AS n FROM users WHERE created_at >= ?1 GROUP BY d`, b.from30Iso),
    q(`SELECT COUNT(*) AS n FROM users WHERE created_at < ?1`, b.from30Iso),
    q(`SELECT day AS d, COUNT(DISTINCT user_id) AS n FROM user_activity WHERE day >= ?1 GROUP BY day`, b.utc30),
    q(`SELECT ${TWD("created_at")} AS d, COUNT(*) AS n FROM shares WHERE deleted_at IS NULL AND created_at >= ?1 GROUP BY d`, b.from30Iso),
    q(`SELECT ${TWD("created_at")} AS d, COUNT(*) AS n FROM photos WHERE deleted_at IS NULL AND purpose = 'share' AND created_at >= ?1 GROUP BY d`, b.from30Iso),
    q(`SELECT ${TWD("created_at")} AS d, COUNT(*) AS n FROM offers WHERE created_at >= ?1 GROUP BY d`, b.from30Iso),
    q(`SELECT ${TWD("sold_at")} AS d, COUNT(*) AS n, COALESCE(SUM(price), 0) AS amount FROM deals WHERE voided_at IS NULL AND sold_at >= ?1 GROUP BY d`, b.from30Iso),
    // 所在地區：跟 geo.ts regionCodes 同一套規則，但整批算
    q(`SELECT user_id AS u, country AS c, COUNT(*) AS n, MAX(day) AS last FROM user_activity WHERE day >= ?1 GROUP BY user_id, country`, b.utc30),
    q(`SELECT u.id AS u, g.register_country AS r, g.last_login_country AS l FROM users u LEFT JOIN user_geo g ON g.user_id = u.id`),
  ]);
  const one = <T,>(i: number) => res[i].results[0] as T;
  const rows = <T,>(i: number) => res[i].results as T[];
  const users = one<{ total: number; today: number; week: number; month: number; verified: number; suspended: number }>(0);
  const active = one<{ a7: number; a30: number }>(1);
  const sh = one<{ total: number; week: number; hidden: number }>(2);
  const ph = one<{ total: number; week: number }>(3);
  const offers = one<{ n: number }>(4).n;
  const deals = one<{ n: number; amount: number }>(5);

  const byDay = (i: number) => new Map(rows<{ d: string; n: number }>(i).map((r) => [r.d, r.n]));
  const newUsers = byDay(6);
  let members = one<{ n: number }>(7).n;
  const act = byDay(8);
  const newShares = byDay(9);
  const newPhotos = byDay(10);
  const newOffers = byDay(11);
  const dealRows = new Map(rows<{ d: string; n: number; amount: number }>(12).map((r) => [r.d, r]));
  const trend: DayPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = twDay(Date.now() - i * 86400_000);
    members += newUsers.get(day) ?? 0;
    trend.push({
      day,
      users: newUsers.get(day) ?? 0,
      members,
      active: act.get(day) ?? 0,
      shares: newShares.get(day) ?? 0,
      photos: newPhotos.get(day) ?? 0,
      offers: newOffers.get(day) ?? 0,
      deals: dealRows.get(day)?.n ?? 0,
      amount: dealRows.get(day)?.amount ?? 0,
    });
  }

  const geoRows = rows<{ u: string; r: string | null; l: string | null }>(14);
  const loginOf = new Map(geoRows.map((g) => [g.u, g.l]));
  const best = new Map<string, { c: string; n: number; last: string }>();
  for (const r of rows<{ u: string; c: string; n: number; last: string }>(13)) {
    if (r.c === "XX" || r.c === "T1") continue;
    const cur = best.get(r.u);
    if (!cur || r.n > cur.n || (r.n === cur.n && (r.last > cur.last || (r.last === cur.last && r.c === loginOf.get(r.u))))) best.set(r.u, r);
  }
  const dist = new Map<string, number>();
  for (const r of geoRows) {
    const code = best.get(r.u)?.c ?? r.l ?? r.r ?? "XX";
    dist.set(code, (dist.get(code) ?? 0) + 1);
  }
  const regions = [...dist.entries()].map(([code, n]) => ({ code, name: countryName(code), n })).sort((a, b) => b.n - a.n);

  return {
    at: new Date().toISOString(),
    members: { ...users, active7: active.a7, active30: active.a30 },
    regions,
    content: { shares: sh.total, sharesWeek: sh.week, hiddenShares: sh.hidden, photos: ph.total, photosWeek: ph.week },
    trade: { offers, deals: deals.n, amount: deals.amount },
    trend,
  };
}

let memo: { at: number; stats: Stats } | null = null;
const cacheReq = (origin: string) => new Request(`${origin}/__yz/admin-stats`);
const defaultCache = () => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined);

/** 儀表板統計；fresh＝略過快取重算。回傳 cached 表示是不是快取 */
export async function dashboardStats(origin: string, fresh = false): Promise<{ stats: Stats; cached: boolean }> {
  const now = Date.now();
  if (!fresh && memo && now - memo.at < TTL * 1000) return { stats: memo.stats, cached: true };
  const cache = defaultCache();
  if (!fresh && cache) {
    const hit = await cache.match(cacheReq(origin)).catch(() => undefined);
    if (hit) {
      const stats = (await hit.json()) as Stats;
      memo = { at: Date.parse(stats.at) || now, stats };
      return { stats, cached: true };
    }
  }
  const stats = await compute();
  memo = { at: now, stats };
  if (cache) {
    await cache
      .put(cacheReq(origin), new Response(JSON.stringify(stats), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL}` } }))
      .catch(() => undefined);
  }
  return { stats, cached: false };
}
