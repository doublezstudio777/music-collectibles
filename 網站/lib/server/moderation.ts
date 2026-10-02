// 檢舉、申訴、管理後台、使用者送出的新增（待審核）。
//
// 2026-09-26 定案：只有認證帳號（已驗證 Email）能檢舉，一人對同一對象一次；
// 達門檻（預設 10，後台可調）＝醒目標示＋交易暫停；被鎖的發文者向樂迷藏申訴，管理員裁決才解鎖。
// 管理員的每個動作（解鎖、維持鎖定、調門檻、核准／退回新增）都寫 admin_log。

import { env } from "cloudflare:workers";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  adminLog,
  appeals,
  artists,
  errorReports,
  items,
  photos,
  reports,
  series,
  settings,
  shares,
  targetDecisions,
  versions,
} from "@/db/schema";
import {
  isTargetLocked,
  KINDS,
  MISC_SERIES_TITLE,
  norm,
  reasonsFor,
  SERIES_KIND_TYPE,
  targetLevel,
  type ErrorReason,
  type Kind,
  type ReportReason,
  type SeriesKind,
  type TargetKey,
} from "@/lib/data";
import { autoSlug, recordAddition, sameNameArtist } from "@/lib/server/additions";
import { ensureItem, ITEM_SLUG, moveWaitingShares, nextSeriesNo, releaseWaitingShares } from "@/lib/server/series-link";
import { loadLockData, parseJson, photoUrl, threshold, userNames } from "@/lib/server/content";
import { contentKeyExists, parseContentKey, shareExists } from "@/lib/server/me";
import { STORAGE_LIMIT, storageUsed, unattachedPhotos } from "@/lib/server/photos";
import { siteStatus } from "@/lib/server/guard";
import { hiddenList } from "@/lib/server/takedown";
import { hit } from "@/lib/server/services";
import { adminComments } from "@/lib/server/comments";
import { HttpError } from "@/lib/server/trade";
import { avatarUrl, isAdmin, type User } from "@/lib/server/auth";
import { avatarReportable } from "@/lib/server/avatars";
import { notifyShareLocked } from "@/lib/server/notify";

const nowIso = () => new Date().toISOString();

export function parseTarget(v: unknown): TargetKey | null {
  if (typeof v !== "string" || v.length > 200) return null;
  if (/^share:\d{1,9}$/.test(v)) return v as TargetKey;
  if (/^item:[a-z0-9-]+\/\d+#[a-z0-9]+$/.test(v)) return v as TargetKey;
  if (/^version:[a-z0-9-]+\/\d+#[a-z0-9]+-[a-z0-9]+$/.test(v)) return v as TargetKey;
  if (/^avatar:[A-Za-z0-9_-]{6,40}$/.test(v)) return v as TargetKey;
  return null;
}

const targetBody = (t: TargetKey) => t.slice(t.indexOf(":") + 1);

async function targetExists(t: TargetKey) {
  const level = targetLevel(t);
  if (level === "share") return shareExists(Number(targetBody(t)));
  if (level === "avatar") return true; // 大頭貼在 report() 裡另外檢查（要知道檢舉人是誰）
  return contentKeyExists(targetBody(t), level);
}

async function log(adminId: string, action: string, target: string, detail: Record<string, unknown>) {
  await getDb().insert(adminLog).values({ adminId, action, target, detail: JSON.stringify(detail) });
}

/* ---------- 檢舉 ---------- */

export async function report(u: User, rawTarget: unknown, reason: unknown, note: unknown, rawPhoto?: unknown) {
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
  if (level === "avatar") {
    const st = await avatarReportable(targetBody(target), u.id);
    if (st === "gone") throw new HttpError(404, "NOT_FOUND", "這張大頭貼已經換掉了");
    if (st === "self") throw new HttpError(403, "FORBIDDEN", "不能檢舉自己的大頭貼");
  }
  if (!(await hit(`report:${u.id}`, 30, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天檢舉太多次了");
  const photoId = await evidencePhoto(u, rawPhoto);
  const r = await getDb()
    .insert(reports)
    .values({ target, reporterId: u.id, reason: reason as ReportReason, note: text, photoId })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  if (!r.length) throw new HttpError(409, "ALREADY_REPORTED", "已經檢舉過了");
  const [c] = await getDb().select({ n: count() }).from(reports).where(eq(reports.target, target));
  const total = c?.n ?? 0;
  // 剛好達門檻、而且管理員沒裁決過：通知作者（2026-10-02 總檢 M2，條款第 12 條第 3 項）。只寄一次（等於門檻那一下）
  if (level === "share" && total === (await threshold())) {
    const [d] = await getDb().select({ d: targetDecisions.decision }).from(targetDecisions).where(eq(targetDecisions.target, target));
    if (!d) {
      const no = Number(targetBody(target));
      const [s] = await getDb().select({ a: shares.authorId, what: shares.what, custom: shares.customWhat }).from(shares).where(eq(shares.no, no));
      const reasonText = reasonsFor("share").map((x) => x.label).join("、");
      if (s) await notifyShareLocked(s.a, no, s.custom || s.what, await reasonSummary(target, reasonText), total);
    }
  }
  return { count: total };
}

/** 這個對象各理由的檢舉數（「疑似盜版 2、其他 1」） */
async function reasonSummary(target: TargetKey, fallback: string) {
  const rows = await getDb().select({ reason: reports.reason, n: count() }).from(reports).where(eq(reports.target, target)).groupBy(reports.reason);
  const labels = new Map<string, string>(reasonsFor(targetLevel(target)).map((x) => [x.key, x.label]));
  const parts = rows.map((r) => `${labels.get(r.reason) ?? r.reason} ${r.n}`);
  return parts.length ? parts.join("、") : fallback;
}

/** 比對照片（選填，最多 1 張）：跟申訴證據同一種上傳（purpose=appeal，只有本人與管理員看得到） */
async function evidencePhoto(u: User, raw: unknown) {
  if (typeof raw !== "string" || !raw) return null;
  const [p] = await unattachedPhotos(u.id, [raw], "appeal");
  if (!p) throw new HttpError(400, "BAD_REQUEST", "比對照片找不到，重新上傳一次");
  return p.id;
}

/* ---------- 錯誤回報（2026-09-28）：不計門檻、不算分，只進後台佇列 ---------- */

const ERROR_REASONS: ErrorReason[] = ["wrong_info", "not_artist", "duplicate", "other"];

export async function errorReport(u: User, rawShare: unknown, reason: unknown, note: unknown, rawPhoto: unknown) {
  const no = typeof rawShare === "number" ? rawShare : Number(rawShare);
  if (!Number.isInteger(no) || no <= 0) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (!ERROR_REASONS.includes(reason as ErrorReason)) throw new HttpError(400, "BAD_REQUEST", "回報原因不對");
  const text = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (!(await shareExists(no))) throw new HttpError(404, "NOT_FOUND", "找不到這則收藏");
  if (!(await hit(`error-report:${u.id}`, 30, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天回報太多次了，明天再來");
  const photoId = await evidencePhoto(u, rawPhoto);
  const r = await getDb()
    .insert(errorReports)
    .values({ shareNo: no, reporterId: u.id, reason: reason as ErrorReason, note: text, photoId })
    .onConflictDoNothing()
    .returning({ id: errorReports.id });
  // 同一則回報過了：一樣回「已收到」，不再多一筆
  return { already: r.length === 0 };
}

export type AdminErrorReport = {
  id: number;
  share: { no: number; what: string; gone: boolean };
  reason: ErrorReason;
  note: string;
  photo: { url: string; thumb: string } | null;
  by: { handle: string; name: string } | null;
  status: "open" | "fixed" | "ignored";
  handledBy: string;
  handledAt: string | null;
  createdAt: string;
};

export async function openErrorReportCount() {
  const [r] = await getDb().select({ n: count() }).from(errorReports).where(eq(errorReports.status, "open"));
  return r?.n ?? 0;
}

/** 後台清單：待處理全部＋最近處理過的 50 筆 */
export async function adminErrorReports(): Promise<AdminErrorReport[]> {
  const db = getDb();
  const [open, done] = await db.batch([
    db.select().from(errorReports).where(eq(errorReports.status, "open")).orderBy(desc(errorReports.id)),
    db.select().from(errorReports).where(inArray(errorReports.status, ["fixed", "ignored"])).orderBy(desc(errorReports.handledAt)).limit(50),
  ]);
  const rows = [...open, ...done];
  const shareNos = [...new Set(rows.map((r) => r.shareNo))];
  const photoIds = rows.map((r) => r.photoId).filter((x): x is string => Boolean(x));
  const [sRows, pRows] = await Promise.all([
    shareNos.length
      ? env.DB!.prepare(`SELECT no, what, deleted_at, hidden_at FROM shares WHERE no IN (SELECT value FROM json_each(?1))`)
          .bind(JSON.stringify(shareNos))
          .all<{ no: number; what: string; deleted_at: string | null; hidden_at: string | null }>()
          .then((x) => x.results ?? [])
      : [],
    photoIds.length
      ? env.DB!.prepare(`SELECT id, r2_key, thumb_key FROM photos WHERE id IN (SELECT value FROM json_each(?1))`)
          .bind(JSON.stringify(photoIds))
          .all<{ id: string; r2_key: string; thumb_key: string }>()
          .then((x) => x.results ?? [])
      : [],
  ]);
  const names = await userNames([...rows.map((r) => r.reporterId), ...rows.map((r) => r.handledBy ?? "")].filter(Boolean));
  return rows.map((r) => {
    const sh = sRows.find((x) => x.no === r.shareNo);
    const p = r.photoId ? pRows.find((x) => x.id === r.photoId) : undefined;
    const who = names.get(r.reporterId);
    return {
      id: r.id,
      share: { no: r.shareNo, what: sh?.what ?? `第 ${r.shareNo} 則`, gone: !sh || Boolean(sh.deleted_at || sh.hidden_at) },
      reason: r.reason as ErrorReason,
      note: r.note,
      photo: p ? { url: photoUrl(p.r2_key), thumb: photoUrl(p.thumb_key) } : null,
      by: who ? { handle: who.handle, name: who.name } : null,
      status: r.status as AdminErrorReport["status"],
      handledBy: r.handledBy ? (names.get(r.handledBy)?.name ?? "") : "",
      handledAt: r.handledAt,
      createdAt: r.createdAt,
    };
  });
}

/** 標記已修正／不處理（寫操作紀錄）；reopen 回到待處理 */
export async function handleErrorReport(admin: User, id: number, action: unknown) {
  if (action !== "fixed" && action !== "ignored" && action !== "reopen") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const at = nowIso();
  const r = await getDb()
    .update(errorReports)
    .set(action === "reopen" ? { status: "open", handledBy: null, handledAt: null } : { status: action, handledBy: admin.id, handledAt: at })
    .where(eq(errorReports.id, id))
    .returning({ shareNo: errorReports.shareNo });
  if (!r.length) throw new HttpError(404, "NOT_FOUND", "找不到這筆回報");
  await log(admin.id, action === "fixed" ? "錯誤回報：已修正" : action === "ignored" ? "錯誤回報：不處理" : "錯誤回報：重新打開", `share:${r[0].shareNo}`, { errorReport: id });
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

const s80 = (v: unknown, n = 80) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export type SubmitKind = "artist" | "series" | "item" | "version";

/**
 * 2026-09-28 上傳表單改版：藝人、系列改成事後審，新增當下就生效（任何人），記進 catalog_additions 給後台確認；
 * 品項、版本維持原本規則（管理員直接生效、會員待審）。
 */
export async function submitContent(u: User, type: unknown, b: Record<string, unknown>) {
  const admin = isAdmin(u);
  const direct = admin || type === "artist" || type === "series" || type === "version";
  const r = await submitInner(u, type, b, direct ? "approved" : "pending", admin);
  if (admin) await log(u.id, "新增（免審核）", `${r.type}:${r.key}`, {});
  return { ...r, approved: direct };
}

async function submitInner(u: User, type: unknown, b: Record<string, unknown>, status: "approved" | "pending", admin: boolean) {
  // 每天 20 筆：擋會員灌資料（事後審的藝人、系列也算）；管理員不受限
  if (!admin && !(await hit(`submit:${u.id}`, 20, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天新增太多筆了，明天再來");
  const db = getDb();
  if (type === "artist") {
    const name = s80(b.name, 60);
    if (!name) throw new HttpError(400, "INVALID", "填藝人名稱");
    // 同名（含別名）的已經在站上：直接用那位，不重複建
    const same = await sameNameArtist(name);
    if (same) {
      return { type, key: same.slug, existing: true, artist: { slug: same.slug, name: same.name, aliases: parseJson<string[]>(same.aliases, []), kind: same.kind, gender: same.gender, region: same.region } };
    }
    // 網址識別碼系統自動產生（介面不問）；撞到就換隨機碼再試
    let slug = "";
    for (let i = 0; i < 5 && !slug; i++) {
      const cand = i === 0 ? autoSlug(name) : autoSlug("");
      const r = await db
        .insert(artists)
        .values({ slug: cand, name, kind: "藝人", status, createdBy: u.id })
        .onConflictDoNothing()
        .returning({ slug: artists.slug });
      if (r.length) slug = r[0].slug;
    }
    if (!slug) throw new HttpError(409, "TAKEN", "新增失敗，再試一次");
    await recordAddition("artist", slug, u);
    return { type, key: slug, artist: { slug, name, aliases: [] as string[], kind: "藝人", gender: null, region: null } };
  }
  if (type === "series") {
    const artist = s80(b.artist, 60);
    const title = s80(b.title, 60);
    // 系列類型（2026-09-28）：album｜ep｜single｜tour｜brand；misc（周邊與其他）由系統建，不能手動新增
    const seriesKind = ["album", "ep", "single", "tour", "brand"].includes(String(b.seriesKind))
      ? (String(b.seriesKind) as Exclude<SeriesKind, "misc">)
      : "album";
    const seriesType = s80(b.seriesType, 20) || SERIES_KIND_TYPE[seriesKind];
    const year = /^\d{4}$/.test(s80(b.year)) ? s80(b.year) : "";
    if (!title) throw new HttpError(400, "INVALID", "填系列名稱");
    if (title === MISC_SERIES_TITLE) throw new HttpError(400, "INVALID", "「周邊與其他」每位藝人都有，直接選就好");
    const [a] = await db
      .select({ slug: artists.slug })
      .from(artists)
      .where(and(eq(artists.slug, artist), eq(artists.status, "approved"), isNull(artists.deletedAt)));
    if (!a) throw new HttpError(404, "NOT_FOUND", "找不到這位藝人");
    // 流水號永不重用：待審、被退回的也算；永久刪除過的系列號也不重用（takedown.ts 記在 counters）
    const no = await nextSeriesNo(artist);
    const name = `${year}《${title}》${seriesType}`;
    const [row] = await db
      .insert(series)
      .values({
        artistSlug: artist,
        no,
        title,
        name,
        seriesType,
        kind: seriesKind,
        year,
        credits: JSON.stringify([artist]),
        status,
        createdBy: u.id,
      })
      .returning({ id: series.id });
    await recordAddition("series", String(row.id), u);
    // 表單新增完直接選它：回傳顯示需要的欄位
    return { type, key: `${artist}/${no}`, id: row.id, series: { key: `${artist}/${no}`, name, title, kind: seriesKind, year, credits: [artist] } };
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
      .values({ seriesId: w.id, itemId, kind, sort: existing.length, status, createdBy: u.id })
      .returning({ id: items.id });
    // 品項至少要有一個版本才會出現；一起送一個待審的版本
    await db.insert(versions).values({ itemRef: it.id, versionId: "v1", edition, status, createdBy: u.id });
    return { type, key: `${seriesKey}#${itemId}` };
  }
  if (type === "version") {
    // 版本（2026-09-29 用字與版本欄）：跟新增藝人、系列一樣事後審，新增當下就能選、能帶進標題；
    // 新增者永遠可以改名（additions.ts renameAddition），後台「待確認的新增」事後確認。
    // 兩種指定方式：itemKey（系列#品項）；或 seriesKey＋kind（系列裡還沒有這種品項時自動建品項）。
    const edition = s80(b.edition, 40);
    if (!edition) throw new HttpError(400, "INVALID", "填版本名稱（例：日版、首批限定、再版）");
    const year = /^\d{4}$/.test(s80(b.year)) ? s80(b.year) : "";
    const region = s80(b.region, 20);
    let itemRef: number | null = null;
    let itemKey = s80(b.itemKey);
    if (itemKey) {
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
            eq(series.status, "approved"),
            isNull(series.deletedAt),
            eq(items.itemId, k.itemId),
            eq(items.status, "approved"),
            isNull(items.deletedAt),
          ),
        );
      if (!row) throw new HttpError(404, "NOT_FOUND", "找不到這個品項");
      itemRef = row.id;
    } else {
      const seriesKey = s80(b.seriesKey);
      const kind = (KINDS as readonly string[]).includes(String(b.kind)) ? (b.kind as Kind) : null;
      const k = parseContentKey(seriesKey);
      if (!kind || !k || k.itemId) throw new HttpError(400, "BAD_REQUEST", "參數不對");
      const [w] = await db
        .select({ id: series.id })
        .from(series)
        .where(and(eq(series.artistSlug, k.artist), eq(series.no, k.no), eq(series.status, "approved"), isNull(series.deletedAt), isNull(series.hiddenAt)));
      if (!w) throw new HttpError(404, "NOT_FOUND", "找不到這個系列");
      const itemId = await ensureItem(w.id, kind, u.id);
      const [it] = await db.select({ id: items.id }).from(items).where(and(eq(items.seriesId, w.id), eq(items.itemId, itemId)));
      itemRef = it.id;
      itemKey = `${seriesKey}#${itemId}`;
    }
    // 同一個品項已經有同名版本（不分大小寫、空白）：直接用那個，不重複建
    const vids = await db
      .select({ id: versions.id, v: versions.versionId, edition: versions.edition, year: versions.year, region: versions.region, status: versions.status, deletedAt: versions.deletedAt, hiddenAt: versions.hiddenAt })
      .from(versions)
      .where(eq(versions.itemRef, itemRef));
    const same = vids.find((x) => x.status === "approved" && !x.deletedAt && !x.hiddenAt && norm(x.edition) === norm(edition) && (!year || !x.year || x.year === year));
    const out = (versionId: string, e: string, y: string, r: string) => ({
      type,
      key: `${itemKey}-${versionId}`,
      itemId: itemKey.split("#")[1],
      version: { id: versionId, edition: e, year: y, region: r, key: `${itemKey}-${versionId}` },
    });
    if (same) return { ...out(same.v, same.edition, same.year, same.region), existing: true };
    // 用最大號＋1（不用筆數），永久刪除過版本也不會撞號
    const top = vids.reduce((n, x) => Math.max(n, Number(x.v.replace(/^v/, "")) || 0), 0);
    const versionId = `v${top + 1}`;
    const [row] = await db
      .insert(versions)
      .values({
        itemRef,
        versionId,
        edition,
        year,
        region,
        catalog: s80(b.catalog, 40) || "待查證",
        barcode: s80(b.barcode, 40) || "無條碼",
        sort: vids.length,
        status,
        createdBy: u.id,
      })
      .returning({ id: versions.id });
    await recordAddition("version", String(row.id), u);
    return out(versionId, edition, year, region);
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
  const allTargets = new Set<string>([...byTarget.keys(), ...apRows.map((a) => a.target)].filter((t) => !t.startsWith("avatar:")));
  // 大頭貼檢舉（2026-09-28）：不鎖交易，另外列一區；已換掉／移除的、管理員按過保留的不列
  const avatarIds = [...byTarget.keys()].filter((t) => t.startsWith("avatar:") && !decisions[t]).map((t) => t.slice(7));
  const avatarRows = avatarIds.length
    ? ((
        await env.DB!.prepare(
          `SELECT p.id, p.r2_key AS key, u.id AS userId, u.handle, u.name FROM photos p JOIN users u ON u.id = p.owner_id
           WHERE p.purpose = 'avatar' AND p.deleted_at IS NULL AND u.avatar_key = p.r2_key AND p.id IN (SELECT value FROM json_each(?1))`,
        )
          .bind(JSON.stringify(avatarIds))
          .all<{ id: string; key: string; userId: string; handle: string; name: string }>()
      ).results ?? [])
    : [];
  // 檢舉附的補充說明與比對照片（2026-09-28）：每個對象最多列 5 筆
  const evRows = await db
    .select({ target: reports.target, note: reports.note, photoId: reports.photoId })
    .from(reports)
    .where(or(ne(reports.note, ""), isNotNull(reports.photoId)))
    .orderBy(desc(reports.id))
    .limit(500);
  const photoIds = [...apRows.flatMap((a) => parseJson<string[]>(a.photoIds, [])), ...evRows.map((r) => r.photoId).filter((x): x is string => Boolean(x))];
  // D1 一句最多 100 個參數：每 90 個分批
  const pics: (typeof photos.$inferSelect)[] = [];
  const uniqPics = [...new Set(photoIds)];
  for (let i = 0; i < uniqPics.length; i += 90) pics.push(...(await db.select().from(photos).where(inArray(photos.id, uniqPics.slice(i, i + 90)))));
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
      evidence: evRows
        .filter((r) => r.target === t)
        .slice(0, 5)
        .map((r) => {
          const p = r.photoId ? pics.find((x) => x.id === r.photoId) : undefined;
          return { note: r.note, ...(p ? { photo: photoUrl(p.thumbKey), full: photoUrl(p.r2Key) } : {}) };
        }),
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
    avatars: avatarRows.map((r) => ({
      target: `avatar:${r.id}`,
      userId: r.userId,
      handle: r.handle,
      name: r.name,
      url: avatarUrl(r.key),
      counts: byTarget.get(`avatar:${r.id}`) ?? {},
      total: counts[`avatar:${r.id}`] ?? 0,
    })),
    // 留言（2026-09-28）：被檢舉還沒處理的、被自動隱藏的
    comments: await adminComments(),
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
  const action = target.startsWith("avatar:")
    ? decision === "kept" ? "保留大頭貼" : "取消裁決"
    : decision === "unlocked" ? "解鎖" : decision === "kept" ? "維持鎖定" : "取消裁決";
  await log(admin.id, action, target, extra);
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
    // 等這個系列的收藏：核准就改掛過去，退回就維持「不確定」
    if (changed) {
      const moved = approve ? await moveWaitingShares(Number(id), admin.id) : (await releaseWaitingShares(Number(id)), 0);
      await log(admin.id, approve ? "核准新增" : "退回新增", `${type}:${id}`, { movedShares: moved });
      return { movedShares: moved };
    }
  } else if (type === "item") {
    changed = (await db.update(items).set({ status }).where(and(eq(items.id, Number(id)), eq(items.status, "pending"))).returning({ k: items.id })).length;
  } else if (type === "version") {
    changed = (await db.update(versions).set({ status }).where(and(eq(versions.id, Number(id)), eq(versions.status, "pending"))).returning({ k: versions.id })).length;
  } else throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (!changed) throw new HttpError(404, "NOT_FOUND", "找不到這筆待審核，或已經處理過");
  await log(admin.id, approve ? "核准新增" : "退回新增", `${type}:${id}`, {});
  return { movedShares: 0 };
}
