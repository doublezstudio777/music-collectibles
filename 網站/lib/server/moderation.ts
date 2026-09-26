// 檢舉、申訴、管理後台、使用者送出的新增（待審核）。
//
// 2026-09-26 定案：只有認證帳號（已驗證 Email）能檢舉，一人對同一對象一次；
// 達門檻（預設 10，後台可調）＝醒目標示＋交易暫停；被鎖的發文者向音藏申訴，管理員裁決才解鎖。
// 管理員的每個動作（解鎖、維持鎖定、調門檻、核准／退回新增）都寫 admin_log。

import { and, count, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { getDb } from "@/db";
import {
  adminLog,
  appeals,
  artists,
  counters,
  items,
  photos,
  reports,
  series,
  settings,
  shares,
  targetDecisions,
  versions,
} from "@/db/schema";
import { isTargetLocked, KINDS, reasonsFor, targetLevel, type Kind, type ReportReason, type TargetKey } from "@/lib/data";
import { loadLockData, parseJson, photoUrl, threshold, userNames } from "@/lib/server/content";
import { contentKeyExists, parseContentKey, shareExists } from "@/lib/server/me";
import { STORAGE_LIMIT, storageUsed, unattachedPhotos } from "@/lib/server/photos";
import { siteStatus } from "@/lib/server/guard";
import { hiddenList } from "@/lib/server/takedown";
import { hit } from "@/lib/server/services";
import { HttpError } from "@/lib/server/trade";
import type { User } from "@/lib/server/auth";

const nowIso = () => new Date().toISOString();

export function parseTarget(v: unknown): TargetKey | null {
  if (typeof v !== "string" || v.length > 200) return null;
  if (/^share:\d{1,9}$/.test(v)) return v as TargetKey;
  if (/^item:[a-z0-9-]+\/\d+#[a-z0-9]+$/.test(v)) return v as TargetKey;
  if (/^version:[a-z0-9-]+\/\d+#[a-z0-9]+-[a-z0-9]+$/.test(v)) return v as TargetKey;
  return null;
}

const targetBody = (t: TargetKey) => t.slice(t.indexOf(":") + 1);

async function targetExists(t: TargetKey) {
  const level = targetLevel(t);
  if (level === "share") return shareExists(Number(targetBody(t)));
  return contentKeyExists(targetBody(t), level);
}

async function log(adminId: string, action: string, target: string, detail: Record<string, unknown>) {
  await getDb().insert(adminLog).values({ adminId, action, target, detail: JSON.stringify(detail) });
}

/* ---------- 檢舉 ---------- */

export async function report(u: User, rawTarget: unknown, reason: unknown, note: unknown) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "NOT_VERIFIED", "認證後才能檢舉");
  const target = parseTarget(rawTarget);
  if (!target) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const level = targetLevel(target);
  if (!reasonsFor(level).some((r) => r.key === reason)) throw new HttpError(400, "BAD_REQUEST", "檢舉理由不對");
  const text = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (reason === "other" && !text) throw new HttpError(400, "INVALID", "寫一句原因");
  if (!(await targetExists(target))) throw new HttpError(404, "NOT_FOUND", "找不到要檢舉的對象");
  if (level === "share") {
    const [s] = await getDb().select({ a: shares.authorId }).from(shares).where(eq(shares.no, Number(targetBody(target))));
    if (s?.a === u.id) throw new HttpError(403, "FORBIDDEN", "不能檢舉自己的收藏");
  }
  if (!(await hit(`report:${u.id}`, 30, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天檢舉太多次了");
  const r = await getDb()
    .insert(reports)
    .values({ target, reporterId: u.id, reason: reason as ReportReason, note: text })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  if (!r.length) throw new HttpError(409, "ALREADY_REPORTED", "已經檢舉過了");
  const [c] = await getDb().select({ n: count() }).from(reports).where(eq(reports.target, target));
  return { count: c?.n ?? 0 };
}

/* ---------- 申訴 ---------- */

/** 申訴資格：被鎖的是自己的收藏，或自己有收藏掛在那個品項／版本底下 */
async function canAppeal(u: User, t: TargetKey) {
  const db = getDb();
  const level = targetLevel(t);
  const key = targetBody(t);
  if (level === "share") {
    const [s] = await db.select({ a: shares.authorId }).from(shares).where(eq(shares.no, Number(key)));
    return s?.a === u.id;
  }
  const k = parseContentKey(key);
  if (!k?.itemId) return false;
  const conds = [
    eq(shares.authorId, u.id),
    eq(shares.seriesKey, `${k.artist}/${k.no}`),
    eq(shares.itemId, k.itemId),
    isNull(shares.deletedAt),
    ...(level === "version" && k.versionId ? [eq(shares.versionId, k.versionId)] : []),
  ];
  const [r] = await db.select({ n: count() }).from(shares).where(and(...conds));
  return (r?.n ?? 0) > 0;
}

export async function submitAppeal(u: User, rawTarget: unknown, text: unknown, photoIds: unknown) {
  const target = parseTarget(rawTarget);
  if (!target) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const body = typeof text === "string" ? text.trim().slice(0, 2000) : "";
  if (!body) throw new HttpError(400, "INVALID", "寫一下正版的證據");
  if (!isTargetLocked(await loadLockData([target]), target)) throw new HttpError(409, "NOT_LOCKED", "這個對象沒有被鎖，不用申訴");
  if (!(await canAppeal(u, target))) throw new HttpError(403, "FORBIDDEN", "只有被鎖的收藏的發文者可以申訴");
  const db = getDb();
  const [pending] = await db
    .select({ id: appeals.id })
    .from(appeals)
    .where(and(eq(appeals.target, target), eq(appeals.byId, u.id), eq(appeals.status, "pending")));
  if (pending) throw new HttpError(409, "ALREADY_APPEALED", "申訴審核中");
  const ids = Array.isArray(photoIds) ? photoIds.filter((x): x is string => typeof x === "string").slice(0, 4) : [];
  const pics = await unattachedPhotos(u.id, ids, "appeal");
  await db.insert(appeals).values({ target, byId: u.id, text: body, photoIds: JSON.stringify(pics.map((p) => p.id)) });
}

/* ---------- 使用者送出的新增（待審核） ---------- */

const ITEM_SLUG: Record<Kind, string> = {
  CD: "cd",
  黑膠: "vinyl",
  卡帶: "cassette",
  "藍光／DVD": "bluray",
  毛巾: "towel",
  "T 恤": "tshirt",
  海報: "poster",
  場刊: "program",
  其他周邊: "goods",
};

const s80 = (v: unknown, n = 80) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export type SubmitKind = "artist" | "series" | "item" | "version";

export async function submitContent(u: User, type: unknown, b: Record<string, unknown>) {
  if (!(await hit(`submit:${u.id}`, 20, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天送出太多筆了，明天再來");
  const db = getDb();
  if (type === "artist") {
    const name = s80(b.name, 60);
    const slug = s80(b.slug, 60).toLowerCase();
    if (!name) throw new HttpError(400, "INVALID", "填藝人名稱");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, "INVALID", "網址用英文名或音譯，小寫英文、數字、連字號");
    const gender = ["male", "female", "group"].includes(String(b.gender)) ? String(b.gender) : null;
    const region = ["domestic", "overseas"].includes(String(b.region)) ? String(b.region) : null;
    const r = await db
      .insert(artists)
      .values({ slug, name, gender, region, kind: b.kind === "發行單位" ? "發行單位" : "藝人", status: "pending", createdBy: u.id })
      .onConflictDoNothing()
      .returning({ slug: artists.slug });
    if (!r.length) throw new HttpError(409, "TAKEN", "這個網址已經有人用了，換一個");
    return { type, key: slug };
  }
  if (type === "series") {
    const artist = s80(b.artist, 60);
    const title = s80(b.title, 60);
    const seriesType = s80(b.seriesType, 20) || "專輯發行";
    const year = /^\d{4}$/.test(s80(b.year)) ? s80(b.year) : "";
    if (!title) throw new HttpError(400, "INVALID", "填系列名稱");
    const [a] = await db
      .select({ slug: artists.slug })
      .from(artists)
      .where(and(eq(artists.slug, artist), eq(artists.status, "approved"), isNull(artists.deletedAt)));
    if (!a) throw new HttpError(404, "NOT_FOUND", "找不到這位藝人");
    // 流水號永不重用：待審、被退回的也算
    const [m] = await db.select({ n: max(series.no) }).from(series).where(eq(series.artistSlug, artist));
    // 永久刪除過的系列號也不重用（takedown.ts 記在 counters）
    const [c] = await db.select({ v: counters.value }).from(counters).where(eq(counters.key, `series_no:${artist}`));
    const no = Math.max(m?.n ?? 0, c?.v ?? 0) + 1;
    await db.insert(series).values({
      artistSlug: artist,
      no,
      title,
      name: `${year}《${title}》${seriesType}`,
      seriesType,
      year,
      credits: JSON.stringify([artist]),
      status: "pending",
      createdBy: u.id,
    });
    return { type, key: `${artist}/${no}` };
  }
  if (type === "item") {
    const seriesKey = s80(b.seriesKey);
    const kind = (KINDS as readonly string[]).includes(String(b.kind)) ? (b.kind as Kind) : null;
    const edition = s80(b.edition, 40) || "一般版";
    if (!kind) throw new HttpError(400, "INVALID", "點一個類型");
    const k = parseContentKey(seriesKey);
    if (!k || k.itemId) throw new HttpError(400, "BAD_REQUEST", "參數不對");
    const [w] = await db
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.artistSlug, k.artist), eq(series.no, k.no), eq(series.status, "approved"), isNull(series.deletedAt)));
    if (!w) throw new HttpError(404, "NOT_FOUND", "找不到這個系列");
    const existing = await db.select({ id: items.itemId }).from(items).where(eq(items.seriesId, w.id));
    const base = ITEM_SLUG[kind];
    let itemId = base;
    for (let i = 2; existing.some((x) => x.id === itemId); i++) itemId = `${base}${i}`;
    const [it] = await db
      .insert(items)
      .values({ seriesId: w.id, itemId, kind, sort: existing.length, status: "pending", createdBy: u.id })
      .returning({ id: items.id });
    // 品項至少要有一個版本才會出現；一起送一個待審的版本
    await db.insert(versions).values({ itemRef: it.id, versionId: "v1", edition, status: "pending", createdBy: u.id });
    return { type, key: `${seriesKey}#${itemId}` };
  }
  if (type === "version") {
    const itemKey = s80(b.itemKey);
    const edition = s80(b.edition, 40);
    if (!edition) throw new HttpError(400, "INVALID", "填版本名稱（例：首批、日版、再版）");
    const k = parseContentKey(itemKey);
    if (!k?.itemId || k.versionId) throw new HttpError(400, "BAD_REQUEST", "參數不對");
    const [row] = await db
      .select({ id: items.id })
      .from(items)
      .innerJoin(series, eq(series.id, items.seriesId))
      .where(
        and(
          eq(series.artistSlug, k.artist),
          eq(series.no, k.no),
          eq(items.itemId, k.itemId),
          eq(items.status, "approved"),
          isNull(items.deletedAt),
        ),
      );
    if (!row) throw new HttpError(404, "NOT_FOUND", "找不到這個品項");
    // 用最大號＋1（不用筆數），永久刪除過版本也不會撞號
    const vids = await db.select({ v: versions.versionId }).from(versions).where(eq(versions.itemRef, row.id));
    const top = vids.reduce((n, x) => Math.max(n, Number(x.v.replace(/^v/, "")) || 0), 0);
    const versionId = `v${top + 1}`;
    await db.insert(versions).values({
      itemRef: row.id,
      versionId,
      edition,
      year: /^\d{4}$/.test(s80(b.year)) ? s80(b.year) : "",
      catalog: s80(b.catalog, 40) || "待查證",
      barcode: s80(b.barcode, 40) || "無條碼",
      status: "pending",
      createdBy: u.id,
    });
    return { type, key: `${itemKey}-${versionId}` };
  }
  throw new HttpError(400, "BAD_REQUEST", "參數不對");
}

/* ---------- 管理後台 ---------- */

export async function adminOverview(viewer: User) {
  const db = getDb();
  const [repRows, apRows, decRows, pa, ps, pi, pv, logRows] = await db.batch([
    db
      .select({ target: reports.target, reason: reports.reason, n: count() })
      .from(reports)
      .groupBy(reports.target, reports.reason),
    db.select().from(appeals).orderBy(desc(appeals.id)),
    db.select().from(targetDecisions),
    db.select().from(artists).where(eq(artists.status, "pending")),
    db.select().from(series).where(eq(series.status, "pending")),
    db
      .select({ id: items.id, itemId: items.itemId, kind: items.kind, createdBy: items.createdBy, createdAt: items.createdAt, sArtist: series.artistSlug, sNo: series.no, sName: series.name })
      .from(items)
      .innerJoin(series, eq(series.id, items.seriesId))
      .where(eq(items.status, "pending")),
    db
      .select({
        id: versions.id,
        versionId: versions.versionId,
        edition: versions.edition,
        createdBy: versions.createdBy,
        createdAt: versions.createdAt,
        itemId: items.itemId,
        kind: items.kind,
        sArtist: series.artistSlug,
        sNo: series.no,
        sName: series.name,
      })
      .from(versions)
      .innerJoin(items, eq(items.id, versions.itemRef))
      .innerJoin(series, eq(series.id, items.seriesId))
      .where(eq(versions.status, "pending")),
    db.select().from(adminLog).orderBy(desc(adminLog.id)).limit(30),
  ]);
  const th = await threshold();
  const decisions = Object.fromEntries(decRows.map((d) => [d.target, d.decision as "unlocked" | "kept"]));
  const byTarget = new Map<string, Record<string, number>>();
  repRows.forEach((r) => {
    const c = byTarget.get(r.target) ?? {};
    c[r.reason] = r.n;
    byTarget.set(r.target, c);
  });
  const counts = Object.fromEntries([...byTarget.entries()].map(([t, c]) => [t, Object.values(c).reduce((a, b) => a + b, 0)]));
  const lockData = { counts, decisions, threshold: th };
  const allTargets = new Set<string>([...byTarget.keys(), ...apRows.map((a) => a.target)]);
  const photoIds = apRows.flatMap((a) => parseJson<string[]>(a.photoIds, []));
  const pics = photoIds.length ? await db.select().from(photos).where(inArray(photos.id, photoIds)) : [];
  const names = await userNames([
    ...apRows.map((a) => a.byId),
    ...logRows.map((l) => l.adminId),
    ...[...pa, ...ps, ...pi, ...pv].map((x) => x.createdBy ?? ""),
  ]);
  const who = (id: string | null) => (id === "system" ? "系統" : id ? (names.get(id)?.name ?? "（已刪除）") : "");
  const { status } = await siteStatus();
  return {
    me: { name: viewer.name },
    site: { ...status, storageUsed: await storageUsed(), storageLimit: STORAGE_LIMIT },
    ...(await hiddenList()),
    threshold: th,
    targets: [...allTargets].map((t) => ({
      target: t,
      counts: byTarget.get(t) ?? {},
      total: counts[t] ?? 0,
      locked: isTargetLocked(lockData, t as TargetKey),
      decision: decisions[t] ?? null,
    })),
    appeals: apRows.map((a) => ({
      id: a.id,
      target: a.target,
      by: who(a.byId),
      text: a.text,
      status: a.status,
      createdAt: a.createdAt,
      photos: parseJson<string[]>(a.photoIds, [])
        .map((id) => pics.find((p) => p.id === id))
        .filter((p): p is (typeof pics)[number] => Boolean(p))
        .map((p) => photoUrl(p.thumbKey)),
    })),
    pending: [
      ...pa.map((a) => ({ type: "artist" as const, id: a.slug, title: a.name, detail: `/artist/${a.slug}`, by: who(a.createdBy), at: a.createdAt })),
      ...ps.map((w) => ({ type: "series" as const, id: String(w.id), title: w.name, detail: `${w.artistSlug}/${w.no}`, by: who(w.createdBy), at: w.createdAt })),
      ...pi.map((i) => ({ type: "item" as const, id: String(i.id), title: `${i.sName} › ${i.kind}`, detail: `${i.sArtist}/${i.sNo}#${i.itemId}`, by: who(i.createdBy), at: i.createdAt })),
      ...pv.map((v) => ({
        type: "version" as const,
        id: String(v.id),
        title: `${v.sName} › ${v.kind} › ${v.edition}`,
        detail: `${v.sArtist}/${v.sNo}#${v.itemId}-${v.versionId}`,
        by: who(v.createdBy),
        at: v.createdAt,
      })),
    ],
    log: logRows.map((l) => ({ id: l.id, by: who(l.adminId), action: l.action, target: l.target, detail: l.detail, at: l.createdAt })),
  };
}

export async function decideAppeal(admin: User, id: number, decision: unknown) {
  if (decision !== "unlocked" && decision !== "kept") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const db = getDb();
  const [a] = await db.select().from(appeals).where(eq(appeals.id, id));
  if (!a) throw new HttpError(404, "NOT_FOUND", "找不到這筆申訴");
  if (a.status !== "pending") throw new HttpError(409, "DECIDED", "這筆已經裁決過");
  const at = nowIso();
  await db.update(appeals).set({ status: decision, decidedBy: admin.id, decidedAt: at }).where(eq(appeals.id, id));
  await setDecision(admin, a.target, decision, { appeal: id });
}

/** 直接對某個對象裁決：unlocked／kept，clear＝回到看門檻 */
export async function setDecision(admin: User, rawTarget: unknown, decision: unknown, extra: Record<string, unknown> = {}) {
  const target = parseTarget(rawTarget);
  if (!target) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const db = getDb();
  if (decision === "clear") {
    await db.delete(targetDecisions).where(eq(targetDecisions.target, target));
  } else if (decision === "unlocked" || decision === "kept") {
    await db
      .insert(targetDecisions)
      .values({ target, decision, decidedBy: admin.id })
      .onConflictDoUpdate({ target: targetDecisions.target, set: { decision, decidedBy: admin.id, decidedAt: nowIso() } });
  } else throw new HttpError(400, "BAD_REQUEST", "參數不對");
  await log(admin.id, decision === "unlocked" ? "解鎖" : decision === "kept" ? "維持鎖定" : "取消裁決", target, extra);
}

export async function setThreshold(admin: User, n: unknown) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, "INVALID", "填 1 以上的整數");
  const before = await threshold();
  await getDb()
    .insert(settings)
    .values({ key: "report_threshold", value: String(n) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(n), updatedAt: nowIso() } });
  await log(admin.id, "調整檢舉門檻", "report_threshold", { from: before, to: n });
}

export async function reviewSubmission(admin: User, type: unknown, id: unknown, approve: unknown) {
  if (typeof approve !== "boolean" || typeof id !== "string") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const status = approve ? "approved" : "rejected";
  const db = getDb();
  const at = nowIso();
  let changed = 0;
  if (type === "artist") {
    changed = (await db.update(artists).set({ status, updatedAt: at, lastEditBy: admin.id }).where(and(eq(artists.slug, id), eq(artists.status, "pending"))).returning({ k: artists.slug })).length;
  } else if (type === "series") {
    changed = (await db.update(series).set({ status, updatedAt: at, lastEditBy: admin.id }).where(and(eq(series.id, Number(id)), eq(series.status, "pending"))).returning({ k: series.id })).length;
  } else if (type === "item") {
    changed = (await db.update(items).set({ status }).where(and(eq(items.id, Number(id)), eq(items.status, "pending"))).returning({ k: items.id })).length;
  } else if (type === "version") {
    changed = (await db.update(versions).set({ status }).where(and(eq(versions.id, Number(id)), eq(versions.status, "pending"))).returning({ k: versions.id })).length;
  } else throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (!changed) throw new HttpError(404, "NOT_FOUND", "找不到這筆待審核，或已經處理過");
  await log(admin.id, approve ? "核准新增" : "退回新增", `${type}:${id}`, {});
}
