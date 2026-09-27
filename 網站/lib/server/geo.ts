// 連線國家、所在地區、交易只限台灣（2026-09-28 防盜版批次）。
//
// 國家來源：worker.ts 把 Cloudflare 判定的 request.cf.country 放進 x-yz-country 表頭（用戶端送來的會被丟掉）。
//
// 交易判定（API 層擋，不是只藏按鈕）：當下連線國家＝TW 才能出價、我要買、接受、成交、改價、改回出售中。
//   不另外要求「註冊國家也是 TW」，理由見 產出/20260928_防盜版與管理後台/README.md「交易判定」。
//
// 所在地區（個人頁、出價列表、私訊標題；只到國家）：最近 30 天「出現天數」最多的國家，
//   同天數取最近出現的；30 天內沒有活動就用最近一次登入的國家，再沒有就用註冊時的國家。
//   活動＝登入者開網站時打 /api/me，同一人同一天同一國只寫一列（isolate 記憶體先擋重複，每人每天最多寫一次）。

import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { userGeo } from "@/db/schema";

export const TRADE_COUNTRY = "TW";
export const TRADE_ONLY_MESSAGE = "交易僅限台灣地區";

export function requestCountry(req: Request): string {
  const c = req.headers.get("x-yz-country") ?? "";
  return /^[A-Z0-9]{2}$/.test(c) ? c : "XX";
}

export const canTrade = (req: Request) => requestCountry(req) === TRADE_COUNTRY;

/** 交易 API 開頭呼叫：不是台灣連線回 403 回應，是台灣回 null */
export function tradeBlocked(req: Request): Response | null {
  if (canTrade(req)) return null;
  return Response.json({ error: { code: "REGION_BLOCKED", message: TRADE_ONLY_MESSAGE } }, { status: 403 });
}

const NAMES: Record<string, string> = {
  TW: "台灣", HK: "香港", MO: "澳門", CN: "中國", JP: "日本", KR: "韓國", US: "美國", CA: "加拿大", GB: "英國",
  AU: "澳洲", NZ: "紐西蘭", SG: "新加坡", MY: "馬來西亞", TH: "泰國", VN: "越南", PH: "菲律賓", ID: "印尼", DE: "德國", FR: "法國",
};
let dn: Intl.DisplayNames | null | undefined;

/** 國碼 → 中文名稱；判定不出來（XX、T1 洋蔥路由）回「未知」 */
export function countryName(code: string | null | undefined): string {
  if (!code || code === "XX" || code === "T1") return "未知";
  if (NAMES[code]) return NAMES[code];
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames(["zh-Hant-TW"], { type: "region" });
    } catch {
      dn = null;
    }
  }
  try {
    return dn?.of(code) ?? code;
  } catch {
    return code;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export async function recordRegister(userId: string, req: Request) {
  const c = requestCountry(req);
  await getDb()
    .insert(userGeo)
    .values({ userId, registerCountry: c })
    .onConflictDoUpdate({ target: userGeo.userId, set: { registerCountry: c } });
}

export async function recordLogin(userId: string, req: Request) {
  const c = requestCountry(req);
  const at = new Date().toISOString();
  await env
    .DB!.batch([
      env.DB!.prepare(
        `INSERT INTO user_geo (user_id, last_login_country, last_login_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET last_login_country = excluded.last_login_country, last_login_at = excluded.last_login_at`,
      ).bind(userId, c, at),
      env.DB!.prepare(`INSERT OR IGNORE INTO user_activity (user_id, day, country) VALUES (?1, ?2, ?3)`).bind(userId, at.slice(0, 10), c),
    ])
    .catch(() => undefined);
}

// 每日活動：isolate 記憶體記住今天已寫過的，同一個 isolate 同一人同一天同一國只寫一次
const seen = new Set<string>();
let seenDay = "";

export async function touchActivity(userId: string, req: Request) {
  const d = today();
  if (d !== seenDay) {
    seen.clear();
    seenDay = d;
  }
  const c = requestCountry(req);
  const k = `${userId}:${c}`;
  if (seen.has(k)) return;
  seen.add(k);
  await env
    .DB!.prepare(`INSERT OR IGNORE INTO user_activity (user_id, day, country) VALUES (?1, ?2, ?3)`)
    .bind(userId, d, c)
    .run()
    .catch(() => seen.delete(k));
}

/** 一批使用者的所在地區（國碼）；沒有任何紀錄的不在結果裡 */
export async function regionCodes(userIds: string[]): Promise<Map<string, string>> {
  const all = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map<string, string>();
  // D1 一個查詢最多 100 個參數：分批
  for (let i = 0; i < all.length; i += 90) for (const [k, v] of await regionChunk(all.slice(i, i + 90))) out.set(k, v);
  return out;
}

async function regionChunk(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const marks = ids.map((_, i) => `?${i + 2}`).join(",");
  const db = env.DB!;
  const [act, geo] = await db.batch([
    db
      .prepare(
        `SELECT user_id AS u, country AS c, COUNT(*) AS d, MAX(day) AS last FROM user_activity
         WHERE day >= ?1 AND user_id IN (${marks}) GROUP BY user_id, country`,
      )
      .bind(since, ...ids),
    db.prepare(`SELECT user_id AS u, register_country AS r, last_login_country AS l FROM user_geo WHERE user_id IN (${ids.map((_, i) => `?${i + 1}`).join(",")})`).bind(...ids),
  ]);
  const geoRows = geo.results as { u: string; r: string | null; l: string | null }[];
  const best = new Map<string, { c: string; d: number; last: string }>();
  for (const r of act.results as { u: string; c: string; d: number; last: string }[]) {
    if (r.c === "XX" || r.c === "T1") continue;
    const b = best.get(r.u);
    // 天數多的優先；同天數取最近出現的；再同（同一天出現在兩國）取最近一次登入的國家
    const login = geoRows.find((x) => x.u === r.u)?.l;
    if (!b || r.d > b.d || (r.d === b.d && (r.last > b.last || (r.last === b.last && r.c === login)))) best.set(r.u, r);
  }
  for (const id of ids) {
    const b = best.get(id);
    if (b) {
      out.set(id, b.c);
      continue;
    }
    const g = geoRows.find((x) => x.u === id);
    const c = g?.l ?? g?.r;
    if (c) out.set(id, c);
  }
  return out;
}

export async function regionNames(userIds: string[]): Promise<Map<string, string>> {
  const codes = await regionCodes(userIds);
  return new Map([...codes].map(([id, c]) => [id, countryName(c)]));
}
