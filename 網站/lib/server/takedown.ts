// 管理員下架權（2c）。
//
// - 隱藏：藝人、系列、品項、版本、炫收藏。前台看不到（頁面 404、牆上不出現、API 當不存在），隨時可恢復
// - 永久刪除：只限「底下完全沒有收藏」的空頁面（藝人、系列、品項、版本）。炫收藏本身就是收藏，只能隱藏
//   「收藏」＝任何一則炫收藏（含已隱藏、已刪除的）或任何人的我有／想要掛在底下；檢舉紀錄也算，免得刪掉後鍵被重用
// - 藝人頁顯示：auto／on（強制顯示）／off（強制不顯示）
// - 每次操作寫 admin_log；永久刪除把整列內容存進紀錄，必要時可以手動補回

import { env } from "cloudflare:workers";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, artists, items, series, shares, versions } from "@/db/schema";
import { parseJson } from "@/lib/server/content";
import { parseContentKey } from "@/lib/server/me";
import { HttpError } from "@/lib/server/trade";
import type { User } from "@/lib/server/auth";

export type HideType = "artist" | "series" | "item" | "version" | "share";
const TYPES: HideType[] = ["artist", "series", "item", "version", "share"];
export const TYPE_WORD: Record<HideType, string> = { artist: "藝人", series: "系列", item: "品項", version: "版本", share: "炫收藏" };

const nowIso = () => new Date().toISOString();

async function log(adminId: string, action: string, target: string, detail: Record<string, unknown> = {}) {
  await getDb().insert(adminLog).values({ adminId, action, target, detail: JSON.stringify(detail) });
}

type Resolved =
  | { type: "artist"; slug: string }
  | { type: "series"; id: number; key: string }
  | { type: "item"; id: number; seriesId: number; key: string }
  | { type: "version"; id: number; key: string }
  | { type: "share"; no: number };

/** 依鍵找到那一列（含已隱藏的，不含已刪除的） */
async function resolve(type: unknown, rawKey: unknown): Promise<Resolved> {
  if (!TYPES.includes(type as HideType) || typeof rawKey !== "string") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const key = rawKey.trim();
  const db = getDb();
  const missing = () => new HttpError(404, "NOT_FOUND", `找不到這個${TYPE_WORD[type as HideType]}`);
  if (type === "share") {
    const no = Number(key.replace(/^\/?share\//, ""));
    if (!Number.isInteger(no) || no < 1) throw missing();
    const [s] = await db.select({ no: shares.no, d: shares.deletedAt }).from(shares).where(eq(shares.no, no));
    if (!s || s.d) throw missing();
    return { type, no };
  }
  if (type === "artist") {
    const [a] = await db.select({ slug: artists.slug, d: artists.deletedAt }).from(artists).where(eq(artists.slug, key));
    if (!a || a.d) throw missing();
    return { type, slug: a.slug };
  }
  const k = parseContentKey(key);
  if (!k) throw missing();
  const [w] = await db
    .select({ id: series.id, d: series.deletedAt })
    .from(series)
    .where(and(eq(series.artistSlug, k.artist), eq(series.no, k.no)));
  if (!w || w.d) throw missing();
  if (type === "series") {
    if (k.itemId) throw missing();
    return { type, id: w.id, key: `${k.artist}/${k.no}` };
  }
  if (!k.itemId) throw missing();
  const [it] = await db.select({ id: items.id, d: items.deletedAt }).from(items).where(and(eq(items.seriesId, w.id), eq(items.itemId, k.itemId)));
  if (!it || it.d) throw missing();
  if (type === "item") {
    if (k.versionId) throw missing();
    return { type, id: it.id, seriesId: w.id, key: `${k.artist}/${k.no}#${k.itemId}` };
  }
  if (!k.versionId) throw missing();
  const [v] = await db.select({ id: versions.id, d: versions.deletedAt }).from(versions).where(and(eq(versions.itemRef, it.id), eq(versions.versionId, k.versionId)));
  if (!v || v.d) throw missing();
  return { type: "version", id: v.id, key: `${k.artist}/${k.no}#${k.itemId}-${k.versionId}` };
}

const label = (r: Resolved) =>
  r.type === "artist" ? `artist:${r.slug}` : r.type === "share" ? `share:${r.no}` : `${r.type}:${r.key}`;

export async function setHidden(admin: User, type: unknown, key: unknown, hidden: unknown) {
  if (typeof hidden !== "boolean") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const r = await resolve(type, key);
  const db = getDb();
  const v = hidden ? nowIso() : null;
  if (r.type === "artist") await db.update(artists).set({ hiddenAt: v }).where(eq(artists.slug, r.slug));
  else if (r.type === "series") await db.update(series).set({ hiddenAt: v }).where(eq(series.id, r.id));
  else if (r.type === "item") await db.update(items).set({ hiddenAt: v }).where(eq(items.id, r.id));
  else if (r.type === "version") await db.update(versions).set({ hiddenAt: v }).where(eq(versions.id, r.id));
  else await db.update(shares).set({ hiddenAt: v }).where(eq(shares.no, r.no));
  await log(admin.id, hidden ? "隱藏" : "恢復", label(r));
  return { target: label(r), hidden };
}

export async function setDisplay(admin: User, slug: unknown, mode: unknown) {
  if (mode !== "auto" && mode !== "on" && mode !== "off") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const r = await resolve("artist", slug);
  if (r.type !== "artist") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  await getDb().update(artists).set({ display: mode }).where(eq(artists.slug, r.slug));
  await log(admin.id, mode === "on" ? "藝人頁強制顯示" : mode === "off" ? "藝人頁強制不顯示" : "藝人頁改回自動", label(r));
  return { slug: r.slug, display: mode };
}

/* ---------- 永久刪除 ---------- */

type Blockers = { shares: number; holdings: number; reports: number; mentions: number };

async function blockersFor(exacts: string[], artist?: { name: string; aliases: string[] }): Promise<Blockers> {
  const db = env.DB!;
  const q = async (sql: string, ...bind: unknown[]) => ((await db.prepare(sql).bind(...bind).first<{ n: number }>())?.n ?? 0);
  let sharesN = 0;
  let holdingsN = 0;
  let reportsN = 0;
  for (const p of exacts) {
    // p：`slug/no`、`slug/no#item`、`slug/no#item-v`
    const [sk, anchor] = p.split("#");
    const [itemId, vid] = (anchor ?? "").split("-");
    sharesN += await q(
      `SELECT COUNT(*) AS n FROM shares WHERE series_key = ?1 ${itemId ? "AND item_id = ?2" : ""} ${vid ? "AND version_id = ?3" : ""}`,
      sk,
      ...(itemId ? [itemId] : []),
      ...(vid ? [vid] : []),
    );
    holdingsN += await q(`SELECT COUNT(*) AS n FROM holdings WHERE target_key = ?1 OR target_key LIKE ?2`, p, `${p}${anchor ? "-" : "#"}%`);
    reportsN += await q(`SELECT COUNT(*) AS n FROM reports WHERE target LIKE ?1 OR target LIKE ?2`, `%:${p}`, `%:${p}${anchor ? "-" : "#"}%`);
  }
  let mentions = 0;
  if (artist) {
    const names = [artist.name, ...artist.aliases].map((x) => x.trim().toLowerCase()).filter(Boolean);
    const rows = await db.prepare(`SELECT about, tags FROM shares`).all<{ about: string; tags: string }>();
    mentions = rows.results.filter((r) =>
      [...parseJson<string[]>(r.about, []), ...parseJson<string[]>(r.tags, [])].some((t) => names.includes(t.trim().toLowerCase())),
    ).length;
  }
  return { shares: sharesN, holdings: holdingsN, reports: reportsN, mentions };
}

const blocked = (b: Blockers) => b.shares + b.holdings + b.reports + b.mentions > 0;

export async function purge(admin: User, type: unknown, key: unknown) {
  if (type === "share") throw new HttpError(400, "NOT_ALLOWED", "炫收藏只能隱藏，不能永久刪除");
  const r = await resolve(type, key);
  const db = getDb();
  const raw = env.DB!;
  let snapshot: unknown;
  if (r.type === "artist") {
    const [a] = await db.select().from(artists).where(eq(artists.slug, r.slug));
    const ss = await db.select().from(series).where(eq(series.artistSlug, r.slug));
    const b = await blockersFor(ss.map((w) => `${w.artistSlug}/${w.no}`), { name: a.name, aliases: parseJson<string[]>(a.aliases, []) });
    // 別的系列把他列為共同署名、客串或合輯收錄，也算底下有東西
    const others = await raw
      .prepare(`SELECT COUNT(*) AS n FROM series WHERE artist_slug != ?1 AND deleted_at IS NULL AND (credits LIKE ?2 OR guests LIKE ?2 OR compilation LIKE ?2)`)
      .bind(r.slug, `%"${r.slug}"%`)
      .first<{ n: number }>();
    if (blocked(b) || (others?.n ?? 0) > 0) throw new HttpError(409, "HAS_CONTENT", blockMessage(b, others?.n ?? 0));
    snapshot = { artist: a, series: ss };
    await purgeSeriesRows(ss.map((w) => w.id));
    await db.delete(artists).where(eq(artists.slug, r.slug));
  } else if (r.type === "series") {
    const b = await blockersFor([r.key]);
    if (blocked(b)) throw new HttpError(409, "HAS_CONTENT", blockMessage(b));
    const [w] = await db.select().from(series).where(eq(series.id, r.id));
    snapshot = { series: w };
    // 流水號永不重用：記下這位藝人用過的最大號
    await raw
      .prepare(`INSERT INTO counters (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)`)
      .bind(`series_no:${w.artistSlug}`, w.no)
      .run();
    await purgeSeriesRows([r.id]);
  } else if (r.type === "item") {
    const b = await blockersFor([r.key]);
    if (blocked(b)) throw new HttpError(409, "HAS_CONTENT", blockMessage(b));
    const [it] = await db.select().from(items).where(eq(items.id, r.id));
    snapshot = { item: it, versions: await db.select().from(versions).where(eq(versions.itemRef, r.id)) };
    await raw.prepare(`DELETE FROM version_marks WHERE version_ref IN (SELECT id FROM versions WHERE item_ref = ?1)`).bind(r.id).run();
    await raw.prepare(`DELETE FROM version_fakes WHERE version_ref IN (SELECT id FROM versions WHERE item_ref = ?1)`).bind(r.id).run();
    await db.delete(versions).where(eq(versions.itemRef, r.id));
    await db.delete(items).where(eq(items.id, r.id));
  } else if (r.type === "version") {
    const b = await blockersFor([r.key]);
    if (blocked(b)) throw new HttpError(409, "HAS_CONTENT", blockMessage(b));
    const [v] = await db.select().from(versions).where(eq(versions.id, r.id));
    snapshot = { version: v };
    await raw.prepare(`DELETE FROM version_marks WHERE version_ref = ?1`).bind(r.id).run();
    await raw.prepare(`DELETE FROM version_fakes WHERE version_ref = ?1`).bind(r.id).run();
    await db.delete(versions).where(eq(versions.id, r.id));
  }
  await log(admin.id, "永久刪除", label(r), { snapshot });
  return { target: label(r), purged: true };
}

async function purgeSeriesRows(ids: number[]) {
  const raw = env.DB!;
  for (const id of ids) {
    await raw.prepare(`DELETE FROM version_marks WHERE version_ref IN (SELECT v.id FROM versions v JOIN items i ON i.id = v.item_ref WHERE i.series_id = ?1)`).bind(id).run();
    await raw.prepare(`DELETE FROM version_fakes WHERE version_ref IN (SELECT v.id FROM versions v JOIN items i ON i.id = v.item_ref WHERE i.series_id = ?1)`).bind(id).run();
    await raw.prepare(`DELETE FROM versions WHERE item_ref IN (SELECT id FROM items WHERE series_id = ?1)`).bind(id).run();
    await raw.prepare(`DELETE FROM items WHERE series_id = ?1`).bind(id).run();
    await raw.prepare(`DELETE FROM series WHERE id = ?1`).bind(id).run();
  }
}

function blockMessage(b: Blockers, credited = 0) {
  const parts = [
    b.shares ? `${b.shares} 則炫收藏` : "",
    b.mentions ? `${b.mentions} 則炫收藏提到他` : "",
    b.holdings ? `${b.holdings} 筆我有／想要` : "",
    b.reports ? `${b.reports} 筆檢舉紀錄` : "",
    credited ? `${credited} 個其他系列列了他` : "",
  ].filter(Boolean);
  return `底下還有東西（${parts.join("、")}），不能永久刪除，只能隱藏`;
}

/* ---------- 後台清單 ---------- */

export async function hiddenList() {
  const db = getDb();
  const [a, w, i, v, s, d] = await db.batch([
    db.select({ slug: artists.slug, name: artists.name, at: artists.hiddenAt }).from(artists).where(isNotNull(artists.hiddenAt)),
    db.select({ slug: series.artistSlug, no: series.no, name: series.name, at: series.hiddenAt }).from(series).where(isNotNull(series.hiddenAt)),
    db
      .select({ slug: series.artistSlug, no: series.no, itemId: items.itemId, kind: items.kind, name: series.name, at: items.hiddenAt })
      .from(items)
      .innerJoin(series, eq(series.id, items.seriesId))
      .where(isNotNull(items.hiddenAt)),
    db
      .select({ slug: series.artistSlug, no: series.no, itemId: items.itemId, vid: versions.versionId, edition: versions.edition, name: series.name, at: versions.hiddenAt })
      .from(versions)
      .innerJoin(items, eq(items.id, versions.itemRef))
      .innerJoin(series, eq(series.id, items.seriesId))
      .where(isNotNull(versions.hiddenAt)),
    db.select({ no: shares.no, what: shares.what, at: shares.hiddenAt }).from(shares).where(isNotNull(shares.hiddenAt)),
    db.select({ slug: artists.slug, name: artists.name, display: artists.display }).from(artists).where(ne(artists.display, "auto")),
  ]);
  return {
    hidden: [
      ...a.map((x) => ({ type: "artist" as const, key: x.slug, title: x.name, at: x.at ?? "" })),
      ...w.map((x) => ({ type: "series" as const, key: `${x.slug}/${x.no}`, title: x.name, at: x.at ?? "" })),
      ...i.map((x) => ({ type: "item" as const, key: `${x.slug}/${x.no}#${x.itemId}`, title: `${x.name} › ${x.kind}`, at: x.at ?? "" })),
      ...v.map((x) => ({ type: "version" as const, key: `${x.slug}/${x.no}#${x.itemId}-${x.vid}`, title: `${x.name} › ${x.edition}`, at: x.at ?? "" })),
      ...s.map((x) => ({ type: "share" as const, key: String(x.no), title: x.what, at: x.at ?? "" })),
    ].sort((p, q) => q.at.localeCompare(p.at)),
    display: d.map((x) => ({ slug: x.slug, name: x.name, display: x.display })),
  };
}

export async function recentLog(limit = 30) {
  return getDb().select().from(adminLog).orderBy(desc(adminLog.id)).limit(limit);
}
