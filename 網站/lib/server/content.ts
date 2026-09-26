// 從 D1 讀內容，組成 lib/catalog.ts 的 Catalog。
//
// 目前資料量小（朋友測試期），一個請求把已核准的內容整包讀出來，頁面在記憶體裡查；
// 資料量起來後改成各頁只查自己要的（已知取捨，寫在 2b 驗收 README）。
// 讚數、我有／想要人數是資料庫實際計數，扣掉目前登入者自己那一下（前端再疊上去，按了馬上變）。

import { cache } from "react";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  artists as tArtists,
  holdings,
  items as tItems,
  likes,
  photos,
  reports,
  series as tSeries,
  settings,
  shares as tShares,
  targetDecisions,
  users,
  versionFakes,
  versionMarks,
  versions as tVersions,
} from "@/db/schema";
import { Catalog } from "@/lib/catalog";
import {
  DEFAULT_THRESHOLD,
  lockFor,
  normKind,
  relTime,
  type Artist,
  type ArtistGender,
  type ArtistRegion,
  type DataStatus,
  type Item,
  type Lock,
  type LockData,
  type SaleState,
  type Series,
  type Share,
  type TargetKey,
  type Version,
} from "@/lib/data";

export const parseJson = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const photoUrl = (key: string) => `/img/${key}`;
const day = (iso: string) => iso.slice(0, 10);

/* ---------- 鎖定（頁面與 API 共用 data.ts 的 lockFor） ---------- */

export async function threshold() {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, "report_threshold"));
  const n = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_THRESHOLD;
}

/** 讀某幾個對象的鎖定資料；不給 targets 就讀全部 */
export async function loadLockData(targets?: TargetKey[]): Promise<LockData> {
  const db = getDb();
  if (targets && targets.length === 0) return { counts: {}, decisions: {}, threshold: await threshold() };
  const where = targets ? inArray(reports.target, targets) : undefined;
  const dWhere = targets ? inArray(targetDecisions.target, targets) : undefined;
  const [c, d] = await db.batch([
    db.select({ target: reports.target, n: count() }).from(reports).where(where).groupBy(reports.target),
    db.select().from(targetDecisions).where(dWhere),
  ]);
  return {
    counts: Object.fromEntries(c.map((x) => [x.target, x.n])),
    decisions: Object.fromEntries(d.map((x) => [x.target, x.decision as "unlocked" | "kept"])),
    threshold: await threshold(),
  };
}

export type ShareRow = typeof tShares.$inferSelect;

export const shareLink = (s: Pick<ShareRow, "seriesKey" | "itemId" | "versionId">) =>
  s.seriesKey ? { seriesKey: s.seriesKey, itemId: s.itemId ?? undefined, versionId: s.versionId ?? undefined } : undefined;

/** 一則收藏現在鎖不鎖：API 擋交易用，跟頁面顯示同一個 lockFor */
export async function lockForShare(s: Pick<ShareRow, "no" | "seriesKey" | "itemId" | "versionId">): Promise<Lock | null> {
  const link = shareLink(s);
  const targets: TargetKey[] = [`share:${s.no}`];
  if (link?.itemId) {
    targets.push(`item:${link.seriesKey}#${link.itemId}`);
    if (link.versionId) targets.push(`version:${link.seriesKey}#${link.itemId}-${link.versionId}`);
  }
  return lockFor(await loadLockData(targets), s.no, link);
}

/* ---------- 整包讀 ---------- */

async function build(viewerId: string | null): Promise<Catalog> {
  const db = getDb();
  const [aRows, sRows, iRows, vRows, mRows, fRows, shRows, uRows, pRows, likeRows, holdRows] = await db.batch([
    db.select().from(tArtists).where(and(eq(tArtists.status, "approved"), isNull(tArtists.deletedAt), isNull(tArtists.hiddenAt))),
    db.select().from(tSeries).where(and(eq(tSeries.status, "approved"), isNull(tSeries.deletedAt), isNull(tSeries.hiddenAt))),
    db.select().from(tItems).where(and(eq(tItems.status, "approved"), isNull(tItems.deletedAt), isNull(tItems.hiddenAt))),
    db.select().from(tVersions).where(and(eq(tVersions.status, "approved"), isNull(tVersions.deletedAt), isNull(tVersions.hiddenAt))),
    db.select().from(versionMarks).where(isNull(versionMarks.deletedAt)),
    db.select().from(versionFakes).where(isNull(versionFakes.deletedAt)),
    db.select().from(tShares).where(and(isNull(tShares.deletedAt), isNull(tShares.hiddenAt))),
    db.select({ id: users.id, handle: users.handle, name: users.name }).from(users),
    db.select().from(photos).where(and(eq(photos.purpose, "share"), isNull(photos.deletedAt))),
    db.select({ n: likes.shareNo, c: count() }).from(likes).groupBy(likes.shareNo),
    db.select({ key: holdings.targetKey, kind: holdings.kind, c: count() }).from(holdings).groupBy(holdings.targetKey, holdings.kind),
  ]);

  const mine = viewerId
    ? await db.batch([
        db.select({ n: likes.shareNo }).from(likes).where(eq(likes.userId, viewerId)),
        db.select({ key: holdings.targetKey, kind: holdings.kind }).from(holdings).where(eq(holdings.userId, viewerId)),
      ])
    : ([[], []] as const);
  const myLikes = new Set(mine[0].map((x) => x.n));
  const myHold = new Set(mine[1].map((x) => `${x.kind}:${x.key}`));

  const userById = new Map(uRows.map((u) => [u.id, u]));
  const handleOf = (id: string | null) => (id ? (userById.get(id)?.handle ?? "") : "");
  const nameOf = (id: string | null) => (id ? (userById.get(id)?.name ?? "") : "");
  const likeCount = new Map(likeRows.map((x) => [x.n, x.c]));
  const holdCount = new Map(holdRows.map((x) => [`${x.kind}:${x.key}`, x.c]));
  const others = (key: string) => (holdCount.get(key) ?? 0) - (myHold.has(key) ? 1 : 0);

  const artists: Artist[] = aRows
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      aliases: parseJson<string[]>(a.aliases, []),
      kind: (a.kind === "發行單位" ? "發行單位" : "藝人") as Artist["kind"],
      ...(a.gender ? { gender: a.gender as ArtistGender } : {}),
      ...(a.region ? { region: a.region as ArtistRegion } : {}),
      tagline: a.tagline,
      intro: parseJson<string[]>(a.intro, []),
      awards: parseJson<Artist["awards"]>(a.awards, []),
      lastEdit: { by: nameOf(a.lastEditBy ?? a.createdBy) || "音藏", date: day(a.updatedAt) },
      ...(a.wikiUrl ? { wiki: { url: a.wikiUrl, license: a.wikiLicense ?? "CC BY-SA 4.0" } } : {}),
      display: (a.display === "on" || a.display === "off" ? a.display : "auto") as Artist["display"],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

  const marksBy = new Map<number, Version["marks"]>();
  for (const m of [...mRows].sort((a, b) => a.sort - b.sort)) {
    const list = marksBy.get(m.versionRef) ?? [];
    list.push({ label: m.label, text: m.text, ...(m.photoNote ? { photo: m.photoNote } : {}) });
    marksBy.set(m.versionRef, list);
  }
  const fakesBy = new Map<number, NonNullable<Version["fakes"]>>();
  for (const f of [...fRows].sort((a, b) => a.sort - b.sort)) {
    const list = fakesBy.get(f.versionRef) ?? [];
    list.push({ name: f.name, seen: f.seen, rows: parseJson(f.rows, []) });
    fakesBy.set(f.versionRef, list);
  }

  const seriesById = new Map<number, Series>();
  const seriesList: Series[] = sRows
    .sort((a, b) => a.artistSlug.localeCompare(b.artistSlug) || a.no - b.no)
    .map((w) => {
      const s: Series = {
        artistSlug: w.artistSlug,
        no: w.no,
        title: w.title,
        name: w.name,
        seriesType: w.seriesType,
        credits: parseJson<string[]>(w.credits, [w.artistSlug]),
        year: w.year,
        body: parseJson<string[]>(w.body, []),
        guests: parseJson(w.guests, []),
        compilation: parseJson(w.compilation, []),
        items: [],
        lastEdit: { by: nameOf(w.lastEditBy ?? w.createdBy) || "音藏", date: day(w.updatedAt) },
      };
      seriesById.set(w.id, s);
      return s;
    });
  const itemById = new Map<number, { item: Item; series: Series }>();
  for (const it of [...iRows].sort((a, b) => a.sort - b.sort || a.id - b.id)) {
    const s = seriesById.get(it.seriesId);
    if (!s) continue;
    const item: Item = { id: it.itemId, kind: normKind(it.kind).kind, versions: [] };
    s.items.push(item);
    itemById.set(it.id, { item, series: s });
  }
  for (const v of [...vRows].sort((a, b) => a.sort - b.sort || a.id - b.id)) {
    const parent = itemById.get(v.itemRef);
    if (!parent) continue;
    const key = `${parent.series.artistSlug}/${parent.series.no}#${parent.item.id}-${v.versionId}`;
    const fakes = fakesBy.get(v.id);
    parent.item.versions.push({
      id: v.versionId,
      edition: v.edition,
      year: v.year,
      region: v.region,
      label: v.label,
      catalog: v.catalog,
      barcode: v.barcode,
      packaging: v.packaging,
      contents: v.contents,
      tracks: v.tracks,
      identifyBy: v.identifyBy,
      ...(marksBy.get(v.id) ? { marks: marksBy.get(v.id) } : {}),
      ...(fakes?.length ? { fakes } : {}),
      status: v.dataStatus as DataStatus,
      owners: others(`owned:${key}`),
      wanted: others(`wanted:${key}`),
      color: v.color,
    });
  }
  // 沒有任何版本的品項不出現（待審的版本不算）
  seriesList.forEach((s) => (s.items = s.items.filter((i) => i.versions.length > 0)));

  const photoBy = new Map<number, (typeof pRows)[number]>();
  for (const p of [...pRows].sort((a, b) => a.sort - b.sort)) {
    if (p.shareNo !== null && !photoBy.has(p.shareNo)) photoBy.set(p.shareNo, p);
  }

  const now = Date.now();
  const shares: Share[] = shRows
    .sort((a, b) => b.no - a.no)
    .map((s) => {
      const p = photoBy.get(s.no);
      const total = likeCount.get(s.no) ?? 0;
      return {
        n: s.no,
        author: handleOf(s.authorId),
        authorName: nameOf(s.authorId),
        time: relTime(s.createdAt, now),
        order: Date.parse(s.createdAt) || s.no,
        what: s.what,
        kind: s.kindNote && s.kind === "其他周邊" ? s.kindNote : s.kind,
        story: s.story,
        about: parseJson<string[]>(s.about, []),
        tags: parseJson<string[]>(s.tags, []),
        likes: total - (myLikes.has(s.no) ? 1 : 0),
        color: s.color,
        ...(p ? { image: photoUrl(p.r2Key), thumb: photoUrl(p.thumbKey) } : {}),
        ...(s.seriesKey
          ? { link: { series: s.seriesKey, ...(s.itemId ? { item: s.itemId } : {}), ...(s.versionId ? { version: s.versionId } : {}) } }
          : {}),
        sale: {
          state: s.saleState as SaleState,
          ...(s.price ? { price: s.price } : {}),
          ...(s.soldPrice ? { soldPrice: s.soldPrice } : {}),
          ...(s.soldTo ? { soldTo: handleOf(s.soldTo) } : {}),
          ...(s.soldAt ? { soldAt: relTime(s.soldAt, now) } : {}),
        },
        ...(s.refPhoto ? { refPhoto: true } : {}),
      };
    });

  return new Catalog(artists, seriesList, shares, await loadLockData());
}

/** 同一個請求（generateMetadata＋頁面）只讀一次 */
export const getCatalog = cache(async (viewerId: string | null) => build(viewerId));

/** 使用者 id → handle／名稱（私訊、後台用） */
export async function userNames(ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return new Map<string, { handle: string; name: string }>();
  const rows = await getDb()
    .select({ id: users.id, handle: users.handle, name: users.name })
    .from(users)
    .where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, { handle: r.handle, name: r.name }]));
}
