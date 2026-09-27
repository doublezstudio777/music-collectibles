// 管理後台：用量與花費（2026-09-28）。
//
// 網站自己記的（D1，一定有）：R2 已用容量（counters.r2_bytes，上限 8GB）、本月照片讀取次數（第二道防線的計數）、暫停模式。
// Cloudflare 那邊的（GraphQL Analytics，要金鑰）：Workers 最近 7 天每天的請求數、錯誤數、CPU p50／p90、各種結束狀態
//   （exceededResources＝超過 CPU 上限的 503）、D1 今天讀寫列數、R2 本月操作次數。
//   金鑰用 Worker secret CF_ANALYTICS_TOKEN，權限只要「Account › Account Analytics › Read」；沒設就顯示「未設定」。
//   結果在 Worker 記憶體放 10 分鐘，後台重整不會一直打 Cloudflare。

import { env } from "cloudflare:workers";
import { siteStatus } from "@/lib/server/guard";
import { STORAGE_LIMIT, storageUsed } from "@/lib/server/photos";

/** 免費額度（Cloudflare 公告，2026-09 查） */
export const FREE = {
  workersRequestsPerDay: 100_000,
  workersCpuMs: 10,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  r2StorageBytes: 10 * 1024 ** 3,
  r2ClassBPerMonth: 10_000_000,
  r2ClassAPerMonth: 1_000_000,
};
const SCRIPT = "yinzang";
const DB_ID = "d70c8f5e-6d9b-4f62-ad21-571d0c827819";
const BUCKET = "yinzang-photos";
const CLASS_B = new Set(["GetObject", "HeadObject", "HeadBucket"]);

export type WorkerDay = { date: string; requests: number; errors: number; exceeded: number; cpuP50: number; cpuP90: number };
export type Analytics =
  | { configured: false; need: string }
  | { configured: true; ok: false; message: string }
  | {
      configured: true;
      ok: true;
      workers: WorkerDay[];
      d1Today: { rowsRead: number; rowsWritten: number };
      r2Month: { classA: number; classB: number };
      at: string;
    };

const NEED = "要在 Cloudflare 建一把只有「Account › Account Analytics › Read」權限的 API 金鑰，用 wrangler secret put CF_ANALYTICS_TOKEN 設進 Worker";

let memo: { at: number; data: Analytics } | null = null;

async function analytics(): Promise<Analytics> {
  const token = env.CF_ANALYTICS_TOKEN;
  const account = env.CF_ACCOUNT_ID;
  if (!token || !account) return { configured: false, need: NEED };
  if (memo && Date.now() - memo.at < 600_000) return memo.data;
  const now = new Date();
  const from = new Date(now.getTime() - 6 * 86400_000);
  from.setUTCHours(0, 0, 0, 0);
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01T00:00:00Z`;
  const query = `query($acc:String!,$from:Time!,$to:Time!,$today:Date!,$month:Time!){viewer{accounts(filter:{accountTag:$acc}){
    w:workersInvocationsAdaptive(limit:200,filter:{scriptName:"${SCRIPT}",datetime_geq:$from,datetime_leq:$to}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP90} dimensions{date status}}
    d:d1AnalyticsAdaptiveGroups(limit:5,filter:{databaseId:"${DB_ID}",date_geq:$today}){sum{rowsRead rowsWritten}}
    r:r2OperationsAdaptiveGroups(limit:50,filter:{bucketName:"${BUCKET}",datetime_geq:$month}){sum{requests} dimensions{actionType}}
  }}}`;
  let data: Analytics;
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { acc: account, from: from.toISOString(), to: now.toISOString(), today, month: monthStart } }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { viewer?: { accounts?: { w: WRow[]; d: { sum: { rowsRead: number; rowsWritten: number } }[]; r: { sum: { requests: number }; dimensions: { actionType: string } }[] }[] } };
      errors?: { message: string }[] | null;
    };
    const acc = body.data?.viewer?.accounts?.[0];
    if (!res.ok || !acc || body.errors?.length) {
      const msg = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
      data = { configured: true, ok: false, message: /auth|permission|not authorized/i.test(msg) ? `金鑰權限不足（${msg}）。${NEED}` : `讀不到 Cloudflare 數據：${msg}` };
    } else {
      data = {
        configured: true,
        ok: true,
        workers: byDay(acc.w),
        d1Today: acc.d.reduce((a, x) => ({ rowsRead: a.rowsRead + x.sum.rowsRead, rowsWritten: a.rowsWritten + x.sum.rowsWritten }), { rowsRead: 0, rowsWritten: 0 }),
        r2Month: acc.r.reduce(
          (a, x) => (CLASS_B.has(x.dimensions.actionType) ? { ...a, classB: a.classB + x.sum.requests } : { ...a, classA: a.classA + x.sum.requests }),
          { classA: 0, classB: 0 },
        ),
        at: now.toISOString(),
      };
    }
  } catch (e) {
    data = { configured: true, ok: false, message: `讀不到 Cloudflare 數據：${(e as Error).message}` };
  }
  memo = { at: Date.now(), data };
  return data;
}

type WRow = { sum: { requests: number; errors: number }; quantiles: { cpuTimeP50: number; cpuTimeP90: number }; dimensions: { date: string; status: string } };

/** 同一天各種結束狀態合併：請求與錯誤相加；CPU 分位數取請求數加權（近似值，GraphQL 不給跨狀態合併的分位數） */
function byDay(rows: WRow[]): WorkerDay[] {
  const m = new Map<string, { req: number; err: number; exc: number; p50: number; p90: number }>();
  for (const r of rows) {
    const d = m.get(r.dimensions.date) ?? { req: 0, err: 0, exc: 0, p50: 0, p90: 0 };
    d.req += r.sum.requests;
    d.err += r.sum.errors;
    if (r.dimensions.status === "exceededResources" || r.dimensions.status === "exceededCpu") d.exc += r.sum.requests;
    d.p50 += (r.quantiles.cpuTimeP50 / 1000) * r.sum.requests;
    d.p90 += (r.quantiles.cpuTimeP90 / 1000) * r.sum.requests;
    m.set(r.dimensions.date, d);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({
      date,
      requests: d.req,
      errors: d.err,
      exceeded: d.exc,
      cpuP50: d.req ? Math.round((d.p50 / d.req) * 10) / 10 : 0,
      cpuP90: d.req ? Math.round((d.p90 / d.req) * 10) / 10 : 0,
    }));
}

export async function usage() {
  const [{ status }, used, cf] = await Promise.all([siteStatus(), storageUsed(), analytics()]);
  return {
    r2: { used, limit: STORAGE_LIMIT, free: FREE.r2StorageBytes },
    reads: { month: status.reads, stopAt: status.readLimit, free: FREE.r2ClassBPerMonth },
    paused: { on: status.paused, at: status.pausedAt, reason: status.pausedReason },
    free: FREE,
    cloudflare: cf,
  };
}
