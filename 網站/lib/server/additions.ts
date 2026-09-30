// 炫收藏表單就地新增的藝人、系列（2026-09-28 上傳表單改版：事前審 → 事後審）。
//
// - 新增當下就是 approved、立即能掛、立即出現在標題；後台「待確認的新增」由管理員事後確認、修名或合併
// - 介面上不出現網址識別碼：藝人 slug 由名稱自動產生（名稱有英數就轉小寫連字號，沒有就用隨機碼），管理員事後可改
// - 新增者永遠可以改自己新增的名稱（不限確認前），每次改都寫 catalog_addition_edits
// - 藝人改名：跟誰有關（shares.about）存的是名稱，同名的一起換；系列改名：掛這個系列的收藏標題重組

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, artists, catalogAdditionEdits, catalogAdditions, items, series, shares, versions } from "@/db/schema";
import { composeWhat, KINDS, norm, SERIES_KIND_TYPE, type Kind, type SeriesKind } from "@/lib/data";
import { isAdmin, type User } from "@/lib/server/auth";
import { parseJson, userNames } from "@/lib/server/content";
import { ensureItem } from "@/lib/server/series-link";
import { mergeArtists } from "@/lib/server/duplicates";
import { creditCreate } from "@/lib/server/scores";
import { HttpError } from "@/lib/server/trade";
import { autofillFor, enqueueAutofill, requeueRef, type AdminAutofill } from "@/lib/server/autofill";

export type AdditionType = "artist" | "series" | "version";
const nowIso = () => new Date().toISOString();

/** 名稱轉網址識別碼：有英數字就用（小寫、連字號），不夠長或全中文就用 a-隨機碼 */
export function autoSlug(name: string) {
  const ascii = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join("");
  return ascii.length >= 2 && /[a-z]/.test(ascii) ? ascii : `a-${rand}`;
}

export async function recordAddition(type: AdditionType, ref: string, u: User) {
  const admin = isAdmin(u);
  const r = await getDb()
    .insert(catalogAdditions)
    .values({ type, ref, createdBy: u.id, ...(admin ? { confirmedAt: nowIso(), confirmedBy: u.id } : {}) })
    .onConflictDoNothing()
    .returning({ id: catalogAdditions.id });
  // 新增 +15 當下入帳（2026-09-29）：藝人用新增紀錄的 id，系列、版本用自己的 id（跟每日彙總同一個來源鍵）
  if (r.length) await creditCreate(u.id, type, type === "artist" ? r[0].id : Number(ref));
  // 發布時自動補資料（2026-09-30）：背景查 MusicBrainz／Wikidata，不卡表單；失敗不影響新增本身
  if (r.length) await enqueueAutofill(r[0].id, type, ref).catch((e) => console.error("[自動補資料] 排工作失敗", e));
}

/** 表單用：這位會員自己新增過的（藝人 slug、系列鍵），這些在表單上是「改名」不是「改」 */
export async function myAdditions(userId: string) {
  const db = getDb();
  const rows = await db.select().from(catalogAdditions).where(eq(catalogAdditions.createdBy, userId));
  const sIds = rows.filter((r) => r.type === "series").map((r) => Number(r.ref));
  const sRows = sIds.length
    ? await db.select({ id: series.id, a: series.artistSlug, no: series.no }).from(series).where(inArray(series.id, sIds.slice(0, 90)))
    : [];
  return {
    artists: rows.filter((r) => r.type === "artist").map((r) => r.ref),
    series: sRows.map((w) => `${w.a}/${w.no}`),
    versions: (await versionRows(rows.filter((r) => r.type === "version").map((r) => Number(r.ref)))).map((v) => v.key),
  };
}

/** 版本列 id → 版本鍵（藝人/流水號#品項-版本）與顯示需要的欄位；每 90 個分批（D1 綁定參數上限） */
async function versionRows(ids: number[]) {
  const db = getDb();
  const out: { id: number; key: string; edition: string; year: string; region: string; seriesId: number; seriesKey: string; seriesTitle: string; artistSlug: string; itemId: string; kind: string; deletedAt: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await db
      .select({ id: versions.id, v: versions.versionId, edition: versions.edition, year: versions.year, region: versions.region, deletedAt: versions.deletedAt, itemId: items.itemId, kind: items.kind, seriesId: series.id, a: series.artistSlug, no: series.no, title: series.title })
      .from(versions)
      .innerJoin(items, eq(items.id, versions.itemRef))
      .innerJoin(series, eq(series.id, items.seriesId))
      .where(inArray(versions.id, ids.slice(i, i + 90)));
    for (const r of rows)
      out.push({ id: r.id, key: `${r.a}/${r.no}#${r.itemId}-${r.v}`, edition: r.edition, year: r.year, region: r.region, seriesId: r.seriesId, seriesKey: `${r.a}/${r.no}`, seriesTitle: r.title, artistSlug: r.a, itemId: r.itemId, kind: r.kind, deletedAt: r.deletedAt });
  }
  return out;
}

async function additionFor(type: AdditionType, ref: string) {
  const [row] = await getDb()
    .select()
    .from(catalogAdditions)
    .where(and(eq(catalogAdditions.type, type), eq(catalogAdditions.ref, ref)));
  return row;
}

/** 重組掛某系列的收藏標題（what 是自動標題；發文者自訂的 custom_what 不動） */
async function recomposeSeriesShares(seriesId: number, key: string, title: string) {
  const db = getDb();
  const rows = await db
    .select({ no: shares.no, kind: shares.kind, kindNote: shares.kindNote, itemId: shares.itemId, versionId: shares.versionId })
    .from(shares)
    .where(eq(shares.seriesKey, key));
  for (const s of rows) {
    let edition = "";
    if (s.itemId && s.versionId) {
      const [v] = await db
        .select({ e: versions.edition })
        .from(versions)
        .innerJoin(items, eq(items.id, versions.itemRef))
        .where(and(eq(items.seriesId, seriesId), eq(items.itemId, s.itemId), eq(versions.versionId, s.versionId)));
      edition = v?.e ?? "";
    }
    const label = s.kind === "其他周邊" ? (s.kindNote ?? s.kind) : s.kind;
    await db.update(shares).set({ what: composeWhat({ series: title, item: label, version: edition }) }).where(eq(shares.no, s.no));
  }
}

/**
 * 改名：{ type, ref, name, year? }。系列的 ref 可以是 series.id 或「藝人/流水號」。
 * 權限：新增者本人或管理員。回傳新的顯示資料給表單。
 */
export async function renameAddition(u: User, rawType: unknown, rawRef: unknown, rawName: unknown, rawYear: unknown, rawRegion?: unknown) {
  const type = rawType === "artist" || rawType === "series" || rawType === "version" ? rawType : null;
  const name = typeof rawName === "string" ? rawName.trim().slice(0, 60) : "";
  if (!type || typeof rawRef !== "string" && typeof rawRef !== "number") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (!name) throw new HttpError(400, "INVALID", "名稱不能空白");
  const db = getDb();
  let ref = String(rawRef);
  let seriesRow: typeof series.$inferSelect | undefined;
  if (type === "version") return renameVersion(u, ref, name, rawYear, rawRegion);
  if (type === "series") {
    const m = /^([a-z0-9-]+)\/(\d+)$/.exec(ref);
    [seriesRow] = m
      ? await db.select().from(series).where(and(eq(series.artistSlug, m[1]), eq(series.no, Number(m[2]))))
      : await db.select().from(series).where(eq(series.id, Number(ref)));
    if (!seriesRow) throw new HttpError(404, "NOT_FOUND", "找不到這筆");
    ref = String(seriesRow.id);
  }
  const add = await additionFor(type, ref);
  if (!add) throw new HttpError(404, "NOT_FOUND", "這筆不是從表單新增的，請用頁面上的編輯");
  if (add.createdBy !== u.id && !isAdmin(u)) throw new HttpError(403, "FORBIDDEN", "只有新增的人可以改名");
  const at = nowIso();

  if (type === "artist") {
    const [a] = await db.select().from(artists).where(eq(artists.slug, ref));
    if (!a || a.deletedAt) throw new HttpError(404, "NOT_FOUND", "找不到這位藝人");
    if (a.name !== name) {
      await db.update(artists).set({ name, updatedAt: at, lastEditBy: u.id }).where(eq(artists.slug, ref));
      // 跟誰有關存名稱：含舊名的收藏一起換（JSON 陣列逐一比對，不用字串取代，避免換到別的名字的一部分）
      const hits = await db.select({ no: shares.no, about: shares.about }).from(shares).where(isNull(shares.deletedAt));
      for (const s of hits) {
        const list = parseJson<string[]>(s.about, []);
        if (!list.includes(a.name)) continue;
        const next = Array.from(new Set(list.map((x) => (x === a.name ? name : x))));
        await db.update(shares).set({ about: JSON.stringify(next) }).where(eq(shares.no, s.no));
      }
      await db.insert(catalogAdditionEdits).values({ additionId: add.id, byId: u.id, fromName: a.name, toName: name });
      await requeueRef("artist", ref);
    }
    return { type, slug: ref, name };
  }

  const w = seriesRow!;
  const year = typeof rawYear === "string" && /^\d{4}$/.test(rawYear.trim()) ? rawYear.trim() : "";
  if (w.title !== name || w.year !== year) {
    const seriesType = w.seriesType || SERIES_KIND_TYPE[(w.kind as Exclude<SeriesKind, "misc">) ?? "album"] || "";
    const full = `${year}《${name}》${seriesType}`;
    await db.update(series).set({ title: name, year, name: full, updatedAt: at, lastEditBy: u.id }).where(eq(series.id, w.id));
    await recomposeSeriesShares(w.id, `${w.artistSlug}/${w.no}`, name);
    await db.insert(catalogAdditionEdits).values({ additionId: add.id, byId: u.id, fromName: w.title, toName: name, fromYear: w.year, toYear: year });
    await requeueRef("series", String(w.id));
  }
  return { type, key: `${w.artistSlug}/${w.no}`, title: name, year, name: `${year}《${name}》${w.seriesType}` };
}

/**
 * 版本改名（2026-09-29）：ref 是版本鍵（藝人/流水號#品項-版本）或 versions.id。可以一起改年份、地區。
 * 掛這個版本的收藏標題重組（自訂標題不動），每次改都留一筆紀錄。
 */
async function renameVersion(u: User, rawRef: string, name: string, rawYear: unknown, rawRegion: unknown) {
  const db = getDb();
  const m = /^([a-z0-9-]+)\/(\d+)#([a-z0-9-]+)-(v\d+)$/.exec(rawRef);
  const [row] = m
    ? await db
        .select({ id: versions.id })
        .from(versions)
        .innerJoin(items, eq(items.id, versions.itemRef))
        .innerJoin(series, eq(series.id, items.seriesId))
        .where(and(eq(series.artistSlug, m[1]), eq(series.no, Number(m[2])), eq(items.itemId, m[3]), eq(versions.versionId, m[4])))
    : await db.select({ id: versions.id }).from(versions).where(eq(versions.id, Number(rawRef) || 0));
  if (!row) throw new HttpError(404, "NOT_FOUND", "找不到這個版本");
  const add = await additionFor("version", String(row.id));
  if (!add) throw new HttpError(404, "NOT_FOUND", "這個版本不是從表單新增的，請到系列頁編輯");
  if (add.createdBy !== u.id && !isAdmin(u)) throw new HttpError(403, "FORBIDDEN", "只有新增的人可以改名");
  const [v] = await versionRows([row.id]);
  if (!v || v.deletedAt) throw new HttpError(404, "NOT_FOUND", "找不到這個版本");
  const year = typeof rawYear === "string" && /^\d{4}$/.test(rawYear.trim()) ? rawYear.trim() : "";
  const region = typeof rawRegion === "string" ? rawRegion.trim().slice(0, 20) : v.region;
  if (norm(v.edition) !== norm(name)) {
    // 同一個品項已經有同名版本：不重複，請直接選那個
    const same = await db
      .select({ edition: versions.edition })
      .from(versions)
      .innerJoin(items, eq(items.id, versions.itemRef))
      .where(and(eq(items.seriesId, v.seriesId), eq(items.itemId, v.itemId), eq(versions.status, "approved"), isNull(versions.deletedAt)));
    if (same.some((x) => norm(x.edition) === norm(name))) throw new HttpError(409, "TAKEN", `這張已經有「${name}」了，直接選它就好`);
  }
  if (v.edition !== name || v.year !== year || v.region !== region) {
    await db.update(versions).set({ edition: name, year, region }).where(eq(versions.id, row.id));
    // 只重組掛這個版本的收藏（同系列其他收藏的標題不動）
    const hits = await db
      .select({ no: shares.no, kind: shares.kind, kindNote: shares.kindNote })
      .from(shares)
      .where(and(eq(shares.seriesKey, v.seriesKey), eq(shares.itemId, v.itemId), eq(shares.versionId, v.key.split("-").pop()!)));
    for (const s of hits) {
      const label = s.kind === "其他周邊" ? (s.kindNote ?? s.kind) : s.kind;
      await db.update(shares).set({ what: composeWhat({ series: v.seriesTitle, item: label, version: name }) }).where(eq(shares.no, s.no));
    }
    await db.insert(catalogAdditionEdits).values({ additionId: add.id, byId: u.id, fromName: v.edition, toName: name, fromYear: v.year, toYear: year });
    await requeueRef("version", String(row.id));
  }
  return { type: "version" as const, key: v.key, itemId: v.itemId, version: { id: v.key.split("-").pop()!, edition: name, year, region, key: v.key } };
}

/* ---------- 後台「待確認的新增」 ---------- */

export type AdminAddition = {
  id: number;
  type: AdditionType;
  ref: string;
  name: string;
  year: string;
  href: string;
  artist?: { slug: string; name: string };
  /** 版本才有：屬於哪個系列・品項 */
  series?: string;
  by: string;
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  used: number;
  gone: boolean;
  edits: { by: string; from: string; to: string; at: string }[];
  /** 自動補資料的結果（沒有就是這筆在功能上線前新增的） */
  autofill?: AdminAutofill;
};

export async function listAdditions(): Promise<AdminAddition[]> {
  const db = getDb();
  const rows = await db.select().from(catalogAdditions).orderBy(desc(catalogAdditions.id)).limit(300);
  const edits = rows.length ? await db.select().from(catalogAdditionEdits).orderBy(desc(catalogAdditionEdits.id)).limit(1000) : [];
  const aRows = await db.select({ slug: artists.slug, name: artists.name, deletedAt: artists.deletedAt }).from(artists);
  const aBy = new Map(aRows.map((a) => [a.slug, a]));
  const sIds = rows.filter((r) => r.type === "series").map((r) => Number(r.ref));
  const sRows: (typeof series.$inferSelect)[] = [];
  for (let i = 0; i < sIds.length; i += 90) sRows.push(...(await db.select().from(series).where(inArray(series.id, sIds.slice(i, i + 90)))));
  const sBy = new Map(sRows.map((w) => [String(w.id), w]));
  const shRows = await db.select({ about: shares.about, seriesKey: shares.seriesKey, itemId: shares.itemId, versionId: shares.versionId }).from(shares).where(isNull(shares.deletedAt));
  const vBy = new Map((await versionRows(rows.filter((r) => r.type === "version").map((r) => Number(r.ref)))).map((v) => [String(v.id), v]));
  const names = await userNames([...rows.flatMap((r) => [r.createdBy, r.confirmedBy ?? ""]), ...edits.map((e) => e.byId)]);
  const who = (id: string | null) => (id ? (names.get(id)?.name ?? "（已刪除）") : null);
  const af = await autofillFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...one(r), autofill: af.get(r.id) }));
  function one(r: (typeof rows)[number]): AdminAddition {
    const own = edits.filter((e) => e.additionId === r.id).map((e) => ({ by: who(e.byId) ?? "", from: e.fromYear || e.toYear ? `${e.fromName}（${e.fromYear || "不記得"}）` : e.fromName, to: e.fromYear || e.toYear ? `${e.toName}（${e.toYear || "不記得"}）` : e.toName, at: e.createdAt }));
    if (r.type === "artist") {
      const a = aBy.get(r.ref);
      const name = a?.name ?? r.ref;
      return {
        id: r.id, type: "artist" as const, ref: r.ref, name, year: "", href: `/artist/${r.ref}`,
        by: who(r.createdBy) ?? "", createdAt: r.createdAt, confirmedAt: r.confirmedAt, confirmedBy: who(r.confirmedBy),
        used: shRows.filter((s) => parseJson<string[]>(s.about, []).includes(name)).length,
        gone: !a || Boolean(a.deletedAt), edits: own,
      };
    }
    if (r.type === "version") {
      const v = vBy.get(r.ref);
      const a = v ? aBy.get(v.artistSlug) : undefined;
      const vid = v ? v.key.split("-").pop()! : "";
      return {
        id: r.id, type: "version" as const, ref: v?.key ?? r.ref, name: v?.edition ?? "（已刪除）", year: v?.year ?? "", href: v ? `/artist/${v.seriesKey}#${v.itemId}-${vid}` : "",
        ...(v ? { artist: { slug: v.artistSlug, name: a?.name ?? v.artistSlug }, series: `${v.seriesTitle}・${v.kind}` } : {}),
        by: who(r.createdBy) ?? "", createdAt: r.createdAt, confirmedAt: r.confirmedAt, confirmedBy: who(r.confirmedBy),
        used: v ? shRows.filter((s) => s.seriesKey === v.seriesKey && s.itemId === v.itemId && s.versionId === vid).length : 0,
        gone: !v || Boolean(v.deletedAt), edits: own,
      };
    }
    const w = sBy.get(r.ref);
    const key = w ? `${w.artistSlug}/${w.no}` : "";
    const a = w ? aBy.get(w.artistSlug) : undefined;
    return {
      id: r.id, type: "series" as const, ref: key || r.ref, name: w?.title ?? "（已刪除）", year: w?.year ?? "", href: key ? `/artist/${key}` : "",
      ...(w ? { artist: { slug: w.artistSlug, name: a?.name ?? w.artistSlug } } : {}),
      by: who(r.createdBy) ?? "", createdAt: r.createdAt, confirmedAt: r.confirmedAt, confirmedBy: who(r.confirmedBy),
      used: key ? shRows.filter((s) => s.seriesKey === key).length : 0,
      gone: !w || Boolean(w.deletedAt), edits: own,
    };
  }
}

async function log(adminId: string, action: string, target: string, detail: Record<string, unknown>) {
  await getDb().insert(adminLog).values({ adminId, action, target, detail: JSON.stringify(detail) });
}

/** 管理員：確認（沒問題）／改回待確認 */
export async function confirmAddition(admin: User, id: number, on: boolean) {
  const db = getDb();
  const r = await db
    .update(catalogAdditions)
    .set(on ? { confirmedAt: nowIso(), confirmedBy: admin.id } : { confirmedAt: null, confirmedBy: null })
    .where(eq(catalogAdditions.id, id))
    .returning({ type: catalogAdditions.type, ref: catalogAdditions.ref });
  if (!r.length) throw new HttpError(404, "NOT_FOUND", "找不到這筆");
  await log(admin.id, on ? "確認新增" : "改回待確認", `${r[0].type}:${r[0].ref}`, {});
}

/**
 * 管理員：把新增的合併到既有的。藝人用既有的藝人合併（系列、收藏、轉址一起搬）；
 * 系列：收藏逐則改掛到目標系列（品項照類型找或建、版本改「不確定」），新增的系列軟刪除。
 */
export async function mergeAddition(admin: User, id: number, rawInto: unknown) {
  const db = getDb();
  const [add] = await db.select().from(catalogAdditions).where(eq(catalogAdditions.id, id));
  if (!add) throw new HttpError(404, "NOT_FOUND", "找不到這筆");
  const into = typeof rawInto === "string" ? rawInto.trim() : "";
  if (add.type === "artist") {
    if (!into || into === add.ref) throw new HttpError(400, "INVALID", "填要併進去的藝人識別碼");
    const r = await mergeArtists(admin, into, add.ref);
    await db.update(catalogAdditions).set({ confirmedAt: nowIso(), confirmedBy: admin.id }).where(eq(catalogAdditions.id, id));
    return r;
  }
  if (add.type === "version") {
    // 版本：併進同一個品項的另一個版本，收藏改掛過去、標題重組，新增的版本軟刪除
    const [lose] = await versionRows([Number(add.ref)]);
    if (!lose || lose.deletedAt) throw new HttpError(404, "NOT_FOUND", "這個版本已經不在了");
    const m = /^([a-z0-9-]+\/\d+#[a-z0-9-]+)-(v\d+)$/.exec(into);
    const loseVid = lose.key.split("-").pop()!;
    if (!m || m[1] !== `${lose.seriesKey}#${lose.itemId}` || m[2] === loseVid)
      throw new HttpError(400, "INVALID", `填同一個品項的另一個版本（例：${lose.seriesKey}#${lose.itemId}-v1）`);
    const [keep] = await db
      .select({ edition: versions.edition })
      .from(versions)
      .innerJoin(items, eq(items.id, versions.itemRef))
      .where(and(eq(items.seriesId, lose.seriesId), eq(items.itemId, lose.itemId), eq(versions.versionId, m[2]), eq(versions.status, "approved"), isNull(versions.deletedAt)));
    if (!keep) throw new HttpError(404, "NOT_FOUND", "找不到要併進去的版本");
    const rows = await db
      .select({ no: shares.no, kind: shares.kind, kindNote: shares.kindNote })
      .from(shares)
      .where(and(eq(shares.seriesKey, lose.seriesKey), eq(shares.itemId, lose.itemId), eq(shares.versionId, loseVid)));
    for (const s of rows) {
      const label = s.kind === "其他周邊" ? (s.kindNote ?? s.kind) : s.kind;
      await db
        .update(shares)
        .set({ versionId: m[2], what: composeWhat({ series: lose.seriesTitle, item: label, version: keep.edition }), updatedAt: nowIso() })
        .where(eq(shares.no, s.no));
    }
    await db.update(versions).set({ deletedAt: nowIso() }).where(eq(versions.id, lose.id));
    await db.update(catalogAdditions).set({ confirmedAt: nowIso(), confirmedBy: admin.id }).where(eq(catalogAdditions.id, id));
    await log(admin.id, "合併新增的版本", `version:${lose.key}`, { into, movedShares: rows.length });
    return { movedShares: rows.length };
  }
  const [lose] = await db.select().from(series).where(eq(series.id, Number(add.ref)));
  const m = /^([a-z0-9-]+)\/(\d+)$/.exec(into);
  const [keep] = m ? await db.select().from(series).where(and(eq(series.artistSlug, m[1]), eq(series.no, Number(m[2])), isNull(series.deletedAt))) : [];
  if (!lose || lose.deletedAt) throw new HttpError(404, "NOT_FOUND", "這個系列已經不在了");
  if (!keep || keep.id === lose.id) throw new HttpError(400, "INVALID", "填要併進去的系列（藝人/流水號，例：gordon/3）");
  const loseKey = `${lose.artistSlug}/${lose.no}`;
  const keepKey = `${keep.artistSlug}/${keep.no}`;
  const rows = await db.select({ no: shares.no, kind: shares.kind, kindNote: shares.kindNote }).from(shares).where(eq(shares.seriesKey, loseKey));
  for (const s of rows) {
    const kind = (KINDS as readonly string[]).includes(s.kind) ? (s.kind as Kind) : "其他周邊";
    const itemId = await ensureItem(keep.id, kind, admin.id);
    const label = kind === "其他周邊" ? (s.kindNote ?? kind) : kind;
    await db
      .update(shares)
      .set({ seriesKey: keepKey, itemId, versionId: null, what: composeWhat({ series: keep.title, item: label, version: "" }), updatedAt: nowIso() })
      .where(eq(shares.no, s.no));
  }
  await db.update(series).set({ deletedAt: nowIso(), updatedAt: nowIso(), lastEditBy: admin.id }).where(eq(series.id, lose.id));
  await db.update(catalogAdditions).set({ confirmedAt: nowIso(), confirmedBy: admin.id }).where(eq(catalogAdditions.id, id));
  await log(admin.id, "合併新增的系列", `series:${loseKey}`, { into: keepKey, movedShares: rows.length });
  return { movedShares: rows.length };
}

/** 同名（含別名）的既有藝人：新增前先比對，同名就直接用既有那位，不重複建 */
export async function sameNameArtist(name: string) {
  const q = norm(name);
  const rows = await getDb()
    .select({ slug: artists.slug, name: artists.name, aliases: artists.aliases, kind: artists.kind, gender: artists.gender, region: artists.region })
    .from(artists)
    .where(and(eq(artists.status, "approved"), isNull(artists.deletedAt), isNull(artists.hiddenAt)));
  return rows.find((a) => norm(a.name) === q || parseJson<string[]>(a.aliases, []).some((x) => norm(x) === q));
}
