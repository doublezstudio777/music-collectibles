// 從 D1 讀內容，組成 lib/catalog.ts 的 Catalog。
//
// 已核准的內容整包讀出來，頁面在記憶體裡查。整包組好的目錄放在 Worker 記憶體（isolate）裡重複用，
// 鍵是 content_version.v（公開內容一有寫入，資料庫觸發器就加 1），所以每個請求只多一個很小的查詢，
// 不會讀到舊資料（2026-09-28 CPU 修正，產出/20260928_CPU修正/README.md）。
// 讚數、我有／想要人數是資料庫實際總數，包含登入者自己那一下：頁面不因人而異，整頁才能快取。
// 前端用 lib/counts.ts 以「拿到這份總數時自己按了沒」扣回去再疊上現在的狀態。

import { cache } from "react";
import { and, count, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  artists as tArtists,
  collectionTags,
  contentVersion,
  holdings,
  items as tItems,
  likes,
  photos,
  reports,
  series as tSeries,
  settings,
  shares as tShares,
  targetDecisions,
  levelOverrides,
  userScores,
  users,
  versionFakes,
  versionMarks,
  versions as tVersions,
} from "@/db/schema";
import { Catalog } from "@/lib/catalog";
import { badgeText } from "@/lib/levels";
import { isAdmin } from "@/lib/server/auth";
import {
  SITE_NAME,
  asSeriesKind,
  DEFAULT_THRESHOLD,
  lockFor,
  normKind,
  relTime,
  type Artist,
  type ArtistGender,
  type ArtistRegion,
  type CollectionData,
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 拿掉曲目欄，其餘照舊
const { trackList: _omitTracks, ...VERSION_COLS } = getTableColumns(tVersions);

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

async function build(): Promise<Catalog> {
  const db = getDb();
  const [aRows, sRows, iRows, vRows, mRows, fRows, shRows, uRows, pRows, likeRows, holdRows, ctRows] = await db.batch([
    db.select().from(tArtists).where(and(eq(tArtists.status, "approved"), isNull(tArtists.deletedAt), isNull(tArtists.hiddenAt))),
    db.select().from(tSeries).where(and(eq(tSeries.status, "approved"), isNull(tSeries.deletedAt), isNull(tSeries.hiddenAt))),
    db.select().from(tItems).where(and(eq(tItems.status, "approved"), isNull(tItems.deletedAt), isNull(tItems.hiddenAt))),
    // 曲目（track_list）不進目錄：整張目錄每次重建都要讀，曲目只有系列頁用，由 lib/server/tracks.ts 另外查
    db.select(VERSION_COLS).from(tVersions).where(and(eq(tVersions.status, "approved"), isNull(tVersions.deletedAt), isNull(tVersions.hiddenAt))),
    db.select().from(versionMarks).where(isNull(versionMarks.deletedAt)),
    db.select().from(versionFakes).where(isNull(versionFakes.deletedAt)),
    db.select().from(tShares).where(and(isNull(tShares.deletedAt), isNull(tShares.hiddenAt))),
    // 等級小標籤跟著目錄一起算（2026-09-29）：卡片、單則頁從快取的 HTML 直接帶，不另外發請求；
    // user_scores 沒有內容版本觸發器，分數變了等下一次內容變動才換，不為等級讓整頁快取失效
    db
      .select({ id: users.id, handle: users.handle, name: users.name, avatarKey: users.avatarKey, email: users.email, emailVerifiedAt: users.emailVerifiedAt, score: userScores.score, override: levelOverrides.level })
      .from(users)
      .leftJoin(userScores, eq(userScores.userId, users.id))
      .leftJoin(levelOverrides, eq(levelOverrides.userId, users.id)),
    db.select().from(photos).where(and(eq(photos.purpose, "share"), isNull(photos.deletedAt))),
    db.select({ n: likes.shareNo, c: count() }).from(likes).groupBy(likes.shareNo),
    db.select({ key: holdings.targetKey, kind: holdings.kind, c: count() }).from(holdings).groupBy(holdings.targetKey, holdings.kind),
    // 全家福合集的標記（2026-10-01）
    db.select().from(collectionTags).orderBy(collectionTags.shareNo, collectionTags.sort),
  ]);

  const userById = new Map(uRows.map((u) => [u.id, u]));
  const handleOf = (id: string | null) => (id ? (userById.get(id)?.handle ?? "") : "");
  const nameOf = (id: string | null) => (id ? (userById.get(id)?.name ?? "") : "");
  // 卡片、單則頁作者欄的大頭貼（2026-09-30）。換大頭貼寫 users.avatar_key，有內容版本觸發器，目錄與整頁快取跟著換新
  const avatarOf = (id: string | null) => {
    const k = id ? userById.get(id)?.avatarKey : null;
    return k ? `/img/${k}` : undefined;
  };
  const badgeOf = (id: string | null) => {
    const u = id ? userById.get(id) : undefined;
    return u ? badgeText(u.score ?? 0, isAdmin(u), u.override) : "";
  };
  const likeCount = new Map(likeRows.map((x) => [x.n, x.c]));
  const holdCount = new Map(holdRows.map((x) => [`${x.kind}:${x.key}`, x.c]));
  const others = (key: string) => holdCount.get(key) ?? 0;

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
      lastEdit: { by: nameOf(a.lastEditBy ?? a.createdBy) || SITE_NAME, date: day(a.updatedAt) },
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
        kind: asSeriesKind(w.kind),
        credits: parseJson<string[]>(w.credits, [w.artistSlug]),
        year: w.year,
        body: parseJson<string[]>(w.body, []),
        guests: parseJson(w.guests, []),
        compilation: parseJson(w.compilation, []),
        items: [],
        lastEdit: { by: nameOf(w.lastEditBy ?? w.createdBy) || SITE_NAME, date: day(w.updatedAt) },
        ...(w.mbid ? { mbid: w.mbid } : {}),
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
      releaseDate: v.releaseDate,
      ...(v.mbid ? { mbid: v.mbid } : {}),
      identifyBy: v.identifyBy,
      ...(marksBy.get(v.id) ? { marks: marksBy.get(v.id) } : {}),
      ...(fakes?.length ? { fakes } : {}),
      status: v.dataStatus as DataStatus,
      owners: others(`owned:${key}`),
      wanted: others(`wanted:${key}`),
      color: v.color,
    });
  }
  // 願望清單人數（2026-10-01 願望清單統一）：想要（任一層的鍵）∪ 對這個系列的炫收藏按愛心，(會員, 系列) 去重後計人。
  // 跟按讚、我有一樣不讓整頁快取作廢（likes／holdings 沒有內容版本觸發器），數字跟著下一次目錄重建更新
  // 2026-10-02 總檢 S10：只算帳號還在用（active）的會員，作者對自己收藏按的愛心不算
  const wishRows = await db.all<{ sk: string; n: number }>(sql`
    SELECT sk, COUNT(*) AS n FROM (
      SELECT h.user_id AS uid, CASE WHEN instr(h.target_key, '#') > 0 THEN substr(h.target_key, 1, instr(h.target_key, '#') - 1) ELSE h.target_key END AS sk
        FROM holdings h JOIN users u ON u.id = h.user_id AND u.status = 'active' WHERE h.kind = 'wanted'
      UNION
      SELECT l.user_id AS uid, s.series_key AS sk FROM likes l JOIN shares s ON s.no = l.share_no JOIN users u ON u.id = l.user_id AND u.status = 'active'
        WHERE s.series_key IS NOT NULL AND s.deleted_at IS NULL AND s.hidden_at IS NULL AND l.user_id != s.author_id
    ) GROUP BY sk`);
  const wishBy = new Map(wishRows.map((r) => [r.sk, Number(r.n)]));
  for (const w of seriesList) {
    const n = wishBy.get(`${w.artistSlug}/${w.no}`);
    if (n) w.wishers = n;
  }

  // 「有，但不確定版本」（系列層、品項層的我有，2026-10-01）：系列頁「N 人有」加上這些人
  for (const w of seriesList) {
    const sk = `${w.artistSlug}/${w.no}`;
    const n = others(`owned:${sk}`) + w.items.reduce((a, it) => a + others(`owned:${sk}#${it.id}`), 0);
    if (n) w.looseOwners = n;
  }

  // 沒有任何版本的品項不出現（待審的版本不算）；例外：有炫收藏掛在上面的（2026-09-28 周邊選擇流程：
  // 發毛巾掛到演唱會、系列裡還沒有毛巾這個品項時會自動建品項，版本等人補，品項要先看得到）
  const itemsWithShares = new Set(
    shRows.filter((s) => s.seriesKey && s.itemId).map((s) => `${s.seriesKey}#${s.itemId}`),
  );
  seriesList.forEach(
    (s) => (s.items = s.items.filter((i) => i.versions.length > 0 || itemsWithShares.has(`${s.artistSlug}/${s.no}#${i.id}`))),
  );

  // 一則最多 10 張，依 sort 排，第一張是封面（卡片、og:image 只用封面）
  const photoBy = new Map<number, (typeof pRows)[number]>();
  const galleryBy = new Map<number, (typeof pRows)[number][]>();
  for (const p of [...pRows].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt))) {
    if (p.shareNo === null) continue;
    if (!photoBy.has(p.shareNo)) photoBy.set(p.shareNo, p);
    galleryBy.set(p.shareNo, [...(galleryBy.get(p.shareNo) ?? []), p]);
  }

  /** 管理員標為辨識參考的照片（版本區塊列出）＋在這則裡的順序（單則頁管理員操作） */
  const refsOf = (list: (typeof pRows)[number][]) => {
    const idx = list.flatMap((g, i) => (g.refAt ? [i] : []));
    return idx.length
      ? { refIdx: idx, refPhotos: idx.map((i) => ({ image: photoUrl(list[i].r2Key), thumb: photoUrl(list[i].thumbKey) })) }
      : {};
  };

  const tagsBy = new Map<number, (typeof ctRows)[number][]>();
  for (const t of ctRows) tagsBy.set(t.shareNo, [...(tagsBy.get(t.shareNo) ?? []), t]);
  /** 合集：全部照片（含尺寸）＋標記；照片上的位置換成照片順序的 index，照片被刪掉的標記只留在清單 */
  const collectionOf = (no: number): CollectionData => {
    const gallery = galleryBy.get(no) ?? [];
    return {
      gallery: gallery.map((g) => ({ image: photoUrl(g.r2Key), thumb: photoUrl(g.thumbKey), w: g.width, h: g.height, ...(g.verifyCode ? { code: g.verifyCode } : {}) })),
      tags: (tagsBy.get(no) ?? []).map((t) => {
        const i = t.photoId ? gallery.findIndex((g) => g.id === t.photoId) : -1;
        return i >= 0 && t.x !== null && t.y !== null ? { key: t.targetKey, photo: i, x: t.x, y: t.y } : { key: t.targetKey };
      }),
    };
  };

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
        authorBadge: badgeOf(s.authorId),
        ...(avatarOf(s.authorId) ? { authorAvatar: avatarOf(s.authorId) } : {}),
        time: relTime(s.createdAt, now),
        order: Date.parse(s.createdAt) || s.no,
        what: s.customWhat || s.what,
        ...(s.customWhat ? { autoWhat: s.what } : {}),
        kind: s.kindNote && s.kind === "其他周邊" ? s.kindNote : s.kind,
        story: s.story,
        about: parseJson<string[]>(s.about, []),
        tags: parseJson<string[]>(s.tags, []),
        likes: total,
        color: s.color,
        ...(p ? { image: photoUrl(p.r2Key), thumb: photoUrl(p.thumbKey) } : {}),
        ...(p && p.width > 0 && p.height > 0 ? { imageSize: { w: p.width, h: p.height } } : {}),
        ...(p?.ogKey ? { og: photoUrl(p.ogKey) } : {}),
        ...(p?.verifyCode ? { code: p.verifyCode } : {}),
        ...((galleryBy.get(s.no)?.length ?? 0) > 1
          ? {
              photos: galleryBy
                .get(s.no)!
                .map((g) => ({ image: photoUrl(g.r2Key), thumb: photoUrl(g.thumbKey), ...(g.verifyCode ? { code: g.verifyCode } : {}) })),
            }
          : {}),
        ...refsOf(galleryBy.get(s.no) ?? []),
        ...(s.editedAt ? { editedAt: s.editedAt } : {}),
        ...(s.postType === "collection" ? { collection: collectionOf(s.no) } : {}),
        ...(s.seriesKey
          ? { link: { series: s.seriesKey, ...(s.itemId ? { item: s.itemId } : {}), ...(s.versionId ? { version: s.versionId } : {}) } }
          : {}),
        sale: {
          state: s.saleState as SaleState,
          ...(s.price ? { price: s.price } : {}),
          ...(s.soldPrice ? { soldPrice: s.soldPrice } : {}),
          ...(s.soldTo ? { soldTo: handleOf(s.soldTo) } : {}),
          ...(s.soldAt ? { soldAt: relTime(s.soldAt, now), soldOn: s.soldAt.slice(0, 10) } : {}),
        },
      };
    });

  return new Catalog(artists, seriesList, shares, await loadLockData());
}

/** 公開內容版本號；讀不到（遷移還沒套）回 -1，呼叫端當作不快取 */
export async function readContentVersion(): Promise<number> {
  try {
    const [row] = await getDb().select({ v: contentVersion.v }).from(contentVersion).where(eq(contentVersion.id, 1));
    return row ? row.v : -1;
  } catch {
    return -1;
  }
}

// isolate 記憶體快取：同一個版本號只組一次。版本號變了（有人改內容、隱藏；按讚、我有、想要 2026-09-28 起不算）下一個請求就重組。
let memo: { v: number; at: number; catalog: Promise<Catalog> } | null = null;
const MEMO_MS = 5 * 60 * 1000; // 相對時間（「3 小時前」）最多舊 5 分鐘

async function cachedCatalog(): Promise<Catalog> {
  const v = await readContentVersion();
  const now = Date.now();
  if (v >= 0 && memo && memo.v === v && now - memo.at < MEMO_MS) return memo.catalog;
  const catalog = build();
  if (v >= 0) {
    memo = { v, at: now, catalog };
    catalog.catch(() => (memo = null));
  }
  return catalog;
}

/** 同一個請求（generateMetadata＋頁面）只讀一次。內容不因登入者而異 */
export const getCatalog = cache(async () => cachedCatalog());

/** 使用者 id → handle／名稱（私訊、後台用） */
export async function userNames(ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return new Map<string, { handle: string; name: string; avatar: string | null }>();
  // 大頭貼一起帶（2026-09-28）；id 超過 90 個分批查（D1 一句最多 100 個參數）
  const rows: { id: string; handle: string; name: string; avatarKey: string | null }[] = [];
  for (let i = 0; i < uniq.length; i += 90) {
    rows.push(
      ...(await getDb()
        .select({ id: users.id, handle: users.handle, name: users.name, avatarKey: users.avatarKey })
        .from(users)
        .where(inArray(users.id, uniq.slice(i, i + 90)))),
    );
  }
  return new Map(rows.map((r) => [r.id, { handle: r.handle, name: r.name, avatar: r.avatarKey ? `/img/${r.avatarKey}` : null }]));
}
