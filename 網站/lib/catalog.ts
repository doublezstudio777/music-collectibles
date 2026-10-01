// 內容目錄：藝人、系列、品項、版本、炫收藏，加上檢舉鎖定資料。
// 伺服器端由 lib/server/content.ts 從 D1 讀出來組成；這支是純函式，不碰資料庫。
//
// 幾條規則寫在這裡，頁面不自己判斷：
// - 共同署名系列：credits 列出所有署名藝人，每位的藝人頁都列為主要作品；資料只有一筆
// - 合作與客串、合輯收錄另外記，不算進對方的主要作品
// - 標籤與藝人名（或別名）撞名時，resolveTagArtist 會找到那位藝人，標籤頁與藝人頁的
//   「相關收藏」用同一份資料

import {
  artistHref,
  getItem,
  itemHref,
  lockFor,
  norm,
  normKind,
  seriesHref,
  seriesKey,
  shareHref,
  tagHref,
  versionHref,
  versionKey,
  versionLabel,
  type Artist,
  type CollectionTagView,
  type ArtistGender,
  type ArtistRegion,
  type HoldingView,
  type LockData,
  type Series,
  type Share,
  type ShareView,
  type TargetKey,
  type TargetLevel,
} from "@/lib/data";
import { LABEL_FORCE_SLUGS } from "@/lib/label-artists";

export type RelatedScope = { series: string } | { tag: string };
export type RelatedBlock = { title: string; href: string; total: number; items: Share[]; scope: RelatedScope };

export class Catalog {
  constructor(
    readonly artists: Artist[],
    readonly seriesList: Series[],
    /** 新的在前 */
    readonly shares: Share[],
    readonly lockData: LockData,
  ) {}

  // 查找表（2026-09-28 CPU 修正）：目錄在 Worker 記憶體裡跨請求重複用，第一次用到才建，建一次。
  // 原本 sharesWithTag 每則收藏的每個標籤都掃一遍整張藝人表，藝人 233 位時首頁一次要 700ms（本機）。
  #memo = new Map<string, unknown>();
  #lazy = <T,>(key: string, make: () => T): T => {
    if (!this.#memo.has(key)) this.#memo.set(key, make());
    return this.#memo.get(key) as T;
  };
  #artistBySlug = () => this.#lazy("artistBySlug", () => new Map(this.artists.map((a) => [a.slug, a])));
  /** 名稱或別名（norm 後）→ 藝人；同名時取目錄順序第一位，跟原本 find 的結果一樣 */
  #artistByName = () =>
    this.#lazy("artistByName", () => {
      const m = new Map<string, Artist>();
      for (const a of this.artists) for (const x of [a.name, ...a.aliases]) if (!m.has(norm(x))) m.set(norm(x), a);
      return m;
    });
  #tagKeys = new Map<string, string>();
  #shareKeys = new WeakMap<object, Set<string>>();
  #keysOf = (share: Pick<Share, "about" | "tags">) => {
    let k = this.#shareKeys.get(share);
    if (!k) {
      k = new Set([...share.about, ...share.tags].map((t) => this.tagKey(t)));
      this.#shareKeys.set(share, k);
    }
    return k;
  };
  #sharesByKey = () =>
    this.#lazy("sharesByKey", () => {
      const m = new Map<string, Share[]>();
      for (const s of this.shares) for (const k of this.#keysOf(s)) {
          const list = m.get(k);
          if (list) list.push(s);
          else m.set(k, [s]);
        }
      return m;
    });
  #visible = new Map<string, boolean>();

  getArtist = (slug: string) => this.#artistBySlug().get(slug);

  /**
   * 藝人頁對外顯示嗎（2c）：沒有任何系列（主要、客串、合輯）也沒有任何相關收藏就不顯示，
   * 直接打網址回 404。管理員可強制開（on）或關（off）。名單可以先匯入，等有人發了收藏才自動出現。
   * 2026-09-29 加：沒有系列與收藏、但「有獎項紀錄且有維基簡介」的也顯示（金曲金音入圍、有維基條目的藝人）。
   */
  artistVisible = (a: Artist) => {
    if (a.display === "on") return true;
    if (a.display === "off") return false;
    const hit = this.#visible.get(a.slug);
    if (hit !== undefined) return hit;
    const v =
      this.mainSeriesOf(a.slug).length > 0 ||
      this.guestSeriesOf(a.slug).length > 0 ||
      this.compilationsOf(a.slug).length > 0 ||
      this.sharesWithTag(a.name).length > 0 ||
      (a.awards.length > 0 && !!a.wiki && a.intro.some((p) => p.trim() !== ""));
    this.#visible.set(a.slug, v);
    return v;
  };

  /** 前台看得到的藝人頁 */
  visibleArtist = (slug: string) => {
    const a = this.getArtist(slug);
    return a && this.artistVisible(a) ? a : undefined;
  };

  /** 藝人目錄：只列藝人（不含發行單位）、只列看得到的，照類型與地區篩 */
  artistDirectory = (gender?: ArtistGender, region?: ArtistRegion) =>
    this.artists
      .filter((a) => a.kind === "藝人" && this.artistVisible(a))
      .filter((a) => (!gender || a.gender === gender) && (!region || a.region === region))
      .map((a) => ({ artist: a, count: this.sharesWithTag(a.name).length }));
  getShare = (n: number) => this.#lazy("shareByNo", () => new Map(this.shares.map((s) => [s.n, s]))).get(n);
  getSeriesByKey = (key: string) =>
    this.#lazy("seriesByKey", () => new Map(this.seriesList.map((w) => [seriesKey(w), w]))).get(key);
  getSeries = (artistSlug: string, no: number) => this.seriesList.find((w) => w.artistSlug === artistSlug && w.no === no);

  resolveVersionKey = (key: string) => {
    const [sk, anchor = ""] = key.split("#");
    const [itemId, vid] = anchor.split("-");
    const series = this.getSeriesByKey(sk);
    const item = series ? getItem(series, itemId) : undefined;
    const version = item?.versions.find((v) => v.id === vid);
    return series && item && version ? { series, item, version } : null;
  };

  resolveItemKey = (key: string) => {
    const [sk, itemId] = key.split("#");
    const series = this.getSeriesByKey(sk);
    const item = series ? getItem(series, itemId) : undefined;
    return series && item ? { series, item } : null;
  };

  /** 標籤撞到藝人名或別名就回傳那位藝人 */
  resolveTagArtist = (tag: string) => this.#artistByName().get(norm(tag));

  /** 合流用的標籤鍵：撞名的一律算成同一位藝人 */
  tagKey = (tag: string) => {
    let k = this.#tagKeys.get(tag);
    if (k === undefined) {
      const artist = this.resolveTagArtist(tag);
      k = artist ? `artist:${artist.slug}` : `tag:${norm(tag)}`;
      this.#tagKeys.set(tag, k);
    }
    return k;
  };

  shareHasTag = (share: Pick<Share, "about" | "tags">, tag: string) => this.#keysOf(share).has(this.tagKey(tag));

  /** 新的在前；回傳新陣列，呼叫端可以自己排序 */
  sharesWithTag = (tag: string) => [...(this.#sharesByKey().get(this.tagKey(tag)) ?? [])];

  /** 主要系列：署名裡有他，共同署名兩邊都列 */
  mainSeriesOf = (slug: string) => this.seriesList.filter((w) => w.credits.includes(slug));

  guestSeriesOf = (slug: string) =>
    this.seriesList.flatMap((w) =>
      w.guests.filter((g) => g.artistSlug === slug).map((g) => ({ series: w, role: g.role, track: g.track })),
    );

  compilationsOf = (slug: string) =>
    this.seriesList.flatMap((w) =>
      w.compilation.filter((c) => c.artistSlug === slug).map((c) => ({ series: w, track: c.track })),
    );

  sharesOfSeries = (w: Series) => this.shares.filter((s) => s.link?.series === seriesKey(w));

  /**
   * 系列卡片封面（2026-09-29）：該系列底下所有品項、所有版本的收藏裡挑一張縮圖，沒被鎖定的才算
   * （隱藏、刪除的收藏本來就不在 this.shares 裡）。優先序照精選排序：已確認版本 → 讚數 → 時間新舊。
   * 藝人頁「系列」、系列頁「其他系列」、系列頁頂部封面都呼叫這支，沒有任何收藏的系列回 null（維持灰色方塊）。
   */
  seriesCover = (w: Series): string | null => {
    const list = this.sharesOfSeries(w).filter((s) => s.thumb && !this.toShareView(s).lock);
    if (!list.length) return null;
    const confirmedRank = (s: Share) => {
      const item = s.link?.item ? getItem(w, s.link.item) : undefined;
      const v = item && s.link?.version ? item.versions.find((x) => x.id === s.link?.version) : undefined;
      return v?.status === "已確認" ? 1 : 0;
    };
    const best = [...list].sort(
      (a, b) => confirmedRank(b) - confirmedRank(a) || b.likes - a.likes || b.order - a.order,
    )[0];
    return best.thumb ?? null;
  };

  creditNames = (w: Series) => w.credits.map((slug) => this.getArtist(slug)).filter((a): a is Artist => Boolean(a));

  /** 這則跟哪些藝人有關（跟誰有關＋標籤撞名） */
  aboutSlugs = (s: Pick<Share, "about" | "tags">) =>
    Array.from(
      new Set([...s.about, ...s.tags].map((t) => this.resolveTagArtist(t)?.slug).filter((x): x is string => Boolean(x))),
    );

  linkHasFakes = (link?: { seriesKey: string; itemId?: string; versionId?: string }) => {
    if (!link?.itemId || !link.versionId) return false;
    const r = this.resolveVersionKey(`${link.seriesKey}#${link.itemId}-${link.versionId}`);
    return Boolean(r?.version.fakes?.length);
  };

  toShareView = (s: Share): ShareView => {
    const w = s.link ? this.getSeriesByKey(s.link.series) : undefined;
    const it = w ? getItem(w, s.link?.item) : undefined;
    const v = it && s.link?.version ? it.versions.find((x) => x.id === s.link?.version) : undefined;
    const k = normKind(s.kind);
    const name = s.authorName ?? s.author;
    const link = w
      ? {
          href: it ? (v ? versionHref(w, it, v) : itemHref(w, it)) : seriesHref(w),
          label: [w.title, it?.kind, v?.edition].filter(Boolean).join(" › "),
          seriesKey: seriesKey(w),
          itemId: it?.id,
          versionId: v?.id,
        }
      : undefined;
    return {
      n: s.n,
      what: s.what,
      kind: k.kind,
      ...(k.note ? { kindNote: k.note } : {}),
      story: s.story,
      time: s.time,
      order: s.order,
      about: s.about,
      tags: s.tags,
      likes: s.likes,
      color: s.color,
      ...(s.image ? { image: s.image } : {}),
      ...(s.thumb ? { thumb: s.thumb } : {}),
      author: {
        handle: s.author,
        name,
        initials: Array.from(name)[0] ?? "?",
        ...(s.authorBadge ? { badge: s.authorBadge } : {}),
        ...(s.authorAvatar ? { avatar: s.authorAvatar } : {}),
      },
      ...(link ? { link } : {}),
      sale: s.sale ?? { state: "share" },
      aboutSlugs: this.aboutSlugs(s),
      hasFakes: this.linkHasFakes(link),
      lock: lockFor(this.lockData, s.n, link),
      ...this.#tagLinksOf(s),
      ...(s.collection ? { collection: { count: s.collection.tags.length } } : {}),
    };
  };

  /** 標籤對應到公開藝人頁就直接連藝人頁（名稱、別名、合併後併入的舊名都算）；被隱藏或沒有公開頁的照舊連標籤頁 */
  artistForTag = (tag: string) => {
    const a = this.resolveTagArtist(tag);
    return a && this.artistVisible(a) ? a : undefined;
  };

  #tagLinksOf = (s: Pick<Share, "about" | "tags">) => {
    const out: Record<string, string> = {};
    for (const t of [...s.about, ...s.tags]) {
      const a = this.artistForTag(t);
      if (a) out[t] = artistHref(a.slug);
    }
    return Object.keys(out).length ? { tagLinks: out } : {};
  };

  /** 單則頁用：加上全部照片（卡片、列表只用封面，不帶這串，省 HTML 大小） */
  toDetailView = (s: Share): ShareView => ({
    ...this.toShareView(s),
    ...(s.photos ? { photos: s.photos } : {}),
    ...(s.code ? { code: s.code } : {}),
    ...(s.refIdx?.length ? { refIdx: s.refIdx } : {}),
    ...(s.editedAt ? { editedAt: s.editedAt } : {}),
    ...(s.collection
      ? {
          collection: {
            count: s.collection.tags.length,
            gallery: s.collection.gallery,
            tags: s.collection.tags.map((t) => this.collectionTagView(t.key, t)).filter((t): t is CollectionTagView => t !== null),
          },
        }
      : {}),
  });

  /* ---------- 全家福合集、我有（2026-10-01 一次發多張） ---------- */

  /**
   * 系列鍵、品項鍵、版本鍵 → 顯示用的一列：藝人、專輯、版本（不確定版本也寫出來）、連結。
   * 找不到（被隱藏、刪除）回 null
   */
  keyView = (key: string) => {
    const [sk, anchor] = key.split("#");
    const w = this.getSeriesByKey(sk);
    if (!w) return null;
    const artist = this.creditNames(w).map((a) => a.name).join("、");
    const first = this.creditNames(w)[0];
    const base = { seriesKey: sk, artist, artistSlug: first?.slug ?? w.artistSlug, artistName: first?.name ?? artist, album: w.title, series: w };
    if (!anchor) return { ...base, version: "不確定版本", href: seriesHref(w), unsure: true, item: undefined, v: undefined };
    const [itemId, vid] = anchor.split("-");
    const it = getItem(w, itemId);
    if (!it) return null;
    if (!vid) return { ...base, version: `${it.kind}・不確定版本`, href: itemHref(w, it), unsure: true, item: it, v: undefined };
    const v = it.versions.find((x) => x.id === vid);
    if (!v) return null;
    return { ...base, version: versionLabel(v, it.kind), href: versionHref(w, it, v), unsure: false, item: it, v };
  };

  collectionTagView = (key: string, pos: { photo?: number; x?: number; y?: number } = {}): CollectionTagView | null => {
    const r = this.keyView(key);
    if (!r) return null;
    return {
      key,
      ...(pos.photo !== undefined ? { photo: pos.photo, x: pos.x, y: pos.y } : {}),
      label: `${r.artist}《${r.album}》${r.version}`,
      artist: r.artist,
      album: r.album,
      version: r.version,
      href: r.href,
      seriesKey: r.seriesKey,
    };
  };

  /**
   * 一位藝人的全部系列＞品項＞版本，勾選用（我收藏了哪些、合集標記）。新的在前，「周邊與其他」排最後。
   * 版本名稱用口語名（2019 台灣 一般版 CD）
   */
  pickSeriesOf = (slug: string): PickSeries[] => {
    const yearOf = (w: Series) => (/^\d{4}/.test(w.year) ? Number(w.year.slice(0, 4)) : -1);
    return this.mainSeriesOf(slug)
      .sort((x, y) => (x.kind === "misc" ? 1 : 0) - (y.kind === "misc" ? 1 : 0) || (yearOf(x) < 0 ? 1 : 0) - (yearOf(y) < 0 ? 1 : 0) || yearOf(y) - yearOf(x) || y.no - x.no)
      .map((w) => ({
        key: seriesKey(w),
        title: w.title,
        year: w.year.slice(0, 4),
        kind: w.kind,
        artist: this.creditNames(w).map((a) => a.name).join("、"),
        items: w.items.map((it) => ({
          id: it.id,
          kind: it.kind,
          versions: it.versions.map((v) => ({ id: v.id, key: versionKey(w, it, v), label: versionLabel(v, it.kind) })),
        })),
      }));
  };

  /**
   * 批次發文的一張（2026-10-01）：鍵 → 發文要帶的系列／品項／版本、跟誰有關、可選的類型。
   * 系列層（不確定版本）的類型要發文者挑：列系列裡已有的品項類型，唱片類系列沒有任何品項時預設 CD
   */
  batchEntryOf = (key: string): BatchEntry | null => {
    const r = this.keyView(key);
    if (!r) return null;
    const about = this.creditNames(r.series).map((a) => a.name);
    const kinds = Array.from(new Set(r.series.items.map((it) => it.kind as string)));
    const base = { key, label: `${r.artist}《${r.album}》${r.version}`, about, seriesKey: r.seriesKey };
    if (r.item) return { ...base, itemId: r.item.id, ...(r.v ? { versionId: r.v.id } : {}), kind: r.item.kind, kinds: [r.item.kind] };
    const options = kinds.length ? kinds : r.series.kind === "tour" || r.series.kind === "misc" || r.series.kind === "brand" ? ["其他周邊"] : ["CD"];
    return { ...base, kind: options[0], kinds: options, itemIds: Object.fromEntries(r.series.items.map((it) => [it.kind, it.id])) };
  };

  /** 系列鍵 → 標了這個系列（或底下任一品項、版本）的合集，新的在前 */
  #collectionsBySeries = () =>
    this.#lazy("collectionsBySeries", () => {
      const m = new Map<string, Share[]>();
      for (const s of this.shares) {
        if (!s.collection) continue;
        for (const sk of new Set(s.collection.tags.map((t) => t.key.split("#")[0]))) m.set(sk, [...(m.get(sk) ?? []), s]);
      }
      return m;
    });

  /** 被標記的專輯頁「出現在 N 個合集中」：被鎖定（檢舉達門檻）的不算 */
  collectionsOf = (w: Series) => (this.#collectionsBySeries().get(seriesKey(w)) ?? []).filter((s) => !this.toShareView(s).lock);

  /** 編輯表單：這則「跟誰有關」對得到的藝人（不在預設清單裡也要能拼出系列選項） */
  formArtistsFor = (names: string[]) =>
    names
      .map((n) => this.resolveTagArtist(n))
      .filter((a): a is Artist => Boolean(a))
      .map(this.#formArtist);

  allShareViews = () => this.shares.map(this.toShareView);

  /**
   * 分享用的四段字：藝人・系列・品項・版本（og:description、原生分享的文字共用）。
   * 藝人取「跟誰有關」，沒有就取系列署名；沒連到系列的只有藝人＋物件類型。
   */
  shareParts = (s: Share) => {
    const w = s.link ? this.getSeriesByKey(s.link.series) : undefined;
    const it = w ? getItem(w, s.link?.item) : undefined;
    const v = it && s.link?.version ? it.versions.find((x) => x.id === s.link?.version) : undefined;
    const artists = (s.about.length ? s.about : w ? this.creditNames(w).map((a) => a.name) : []).join("、");
    return {
      artist: artists,
      series: w?.title ?? "",
      item: it?.kind ?? (w ? "" : normKind(s.kind).kind),
      version: v?.edition ?? "",
    };
  };

  /** 連結預覽用的照片：清單裡第一則有照片、而且沒被鎖的（被隱藏的本來就不在 shares 裡） */
  ogPhotoOf = (list: Share[]) => {
    const s = list.find((x) => (x.thumb ?? x.image) && !this.toShareView(x).lock);
    return s ? ogPhoto(s) : null;
  };

  /**
   * 這個鍵（系列／品項／版本）底下出售中的收藏：定價出售＋開放出價，被鎖的不算（跟系列頁「站上行情」同一套）。
   * 願望清單用（2026-10-01）：「有 N 件出售中」，一件直接連那則，多件連系列頁的版本（或品項、系列）段落
   */
  sellingFor = (key: string) => {
    const [sk, anchor = ""] = key.split("#");
    const [itemId, vid] = anchor ? anchor.split("-") : [];
    return this.shares.filter(
      (s) =>
        s.link?.series === sk &&
        (!itemId || s.link.item === itemId) &&
        (!vid || s.link.version === vid) &&
        (s.sale?.state === "sale" || s.sale?.state === "offer") &&
        !this.toShareView(s).lock,
    );
  };

  /** 我有／想要清單的一列。2026-10-01 起系列鍵、品項鍵（不確定版本）也收 */
  toHoldingView = (key: string): HoldingView | null => {
    const r = this.keyView(key);
    if (!r) return null;
    const selling = this.sellingFor(key);
    return {
      key,
      title: r.series.title,
      artists: r.artist,
      edition: r.unsure ? "不確定版本" : (r.v?.edition ?? ""),
      year: r.v?.year ?? r.series.year.slice(0, 4),
      format: r.item?.kind ?? "",
      catalog: "",
      href: r.href,
      color: r.v?.color ?? "",
      artistSlug: r.artistSlug,
      artistName: r.artistName,
      ...(r.unsure ? { unsure: true } : {}),
      ...(selling.length ? { onSale: selling.length, saleHref: selling.length === 1 ? `/share/${selling[0].n}` : r.href } : {}),
    };
  };

  holdingViews = (keys: string[]) => keys.map(this.toHoldingView).filter((h): h is HoldingView => h !== null);

  search = (query: string) => {
    const q = norm(query);
    if (!q) return { artists: [] as Artist[], series: this.seriesList, shares: [] as Share[] };
    const hit = (...xs: (string | undefined)[]) => xs.some((x) => x && norm(x).includes(q));
    return {
      artists: this.artists.filter((a) => this.artistVisible(a) && hit(a.name, a.tagline, ...a.aliases)),
      series: this.seriesList.filter(
        (w) =>
          hit(w.name, w.seriesType, ...this.creditNames(w).flatMap((a) => [a.name, ...a.aliases])) ||
          w.items.some((it) => hit(it.kind) || it.versions.some((v) => hit(v.edition, v.catalog, v.barcode))),
      ),
      shares: this.shares.filter((s) => hit(s.what, s.story, ...s.about, ...s.tags)),
    };
  };

  /**
   * 單則頁底部的相關收藏：同系列優先，其次同藝人（跟誰有關，或標籤撞到藝人名）。
   * 不放「同一位會員的其他收藏」。最多兩塊、每塊三張；來源不足三則的整塊不出現。
   */
  relatedFor = (share: Share): RelatedBlock[] => {
    const others = this.shares.filter((s) => s.n !== share.n);
    const sources: { title: string; href: string; match: (s: Share) => boolean; scope: RelatedScope }[] = [];
    const series = share.link ? this.getSeriesByKey(share.link.series) : undefined;
    if (series) {
      sources.push({
        title: `${series.name}的其他收藏`,
        href: seriesHref(series),
        match: (s) => s.link?.series === share.link?.series,
        scope: { series: seriesKey(series) },
      });
    }
    const seen = new Set<string>();
    for (const t of [...share.about, ...share.tags]) {
      const a = this.resolveTagArtist(t);
      if (!a || seen.has(a.slug)) continue;
      seen.add(a.slug);
      sources.push({ title: `跟${a.name}有關的其他收藏`, href: this.artistVisible(a) ? artistHref(a.slug) : tagHref(a.name), match: (s) => this.shareHasTag(s, t), scope: { tag: a.name } });
    }
    const used = new Set<number>();
    const blocks: RelatedBlock[] = [];
    for (const src of sources) {
      if (blocks.length === 2) break;
      const all = others.filter(src.match);
      const fresh = all.filter((s) => !used.has(s.n));
      if (fresh.length < 3) continue;
      const items = fresh.slice(0, 3);
      items.forEach((s) => used.add(s.n));
      blocks.push({ title: src.title, href: src.href, total: all.length, items, scope: src.scope });
    }
    return blocks;
  };

  /** 對象的顯示名稱與連結 */
  describeTarget = (target: TargetKey): { level: TargetLevel; levelName: string; title: string; href: string } => {
    const level = target.slice(0, target.indexOf(":")) as TargetLevel;
    const key = target.slice(target.indexOf(":") + 1);
    if (level === "share") {
      const n = Number(key);
      return { level, levelName: "收藏", title: this.getShare(n)?.what ?? `第 ${n} 則`, href: shareHref(n) };
    }
    if (level === "item") {
      const r = this.resolveItemKey(key);
      return r
        ? { level, levelName: "品項", title: `${r.series.name} › ${r.item.kind}`, href: itemHref(r.series, r.item) }
        : { level, levelName: "品項", title: key, href: "/" };
    }
    const r = this.resolveVersionKey(key);
    return r
      ? { level, levelName: "版本", title: `${r.series.name} › ${r.item.kind} › ${r.version.edition}`, href: versionHref(r.series, r.item, r.version) }
      : { level, levelName: "版本", title: key, href: "/" };
  };

  /**
   * 表單用藝人：只留挑選要用的欄位（不含簡介、獎項），送到前端的量小很多。
   */
  #formArtist = (a: Artist) => ({
    slug: a.slug,
    name: a.name,
    aliases: a.aliases,
    kind: a.kind,
    gender: a.gender ?? null,
    region: a.region ?? null,
  });

  /**
   * 全站最近有人發過收藏的藝人 slug：新的在前（沿用 shares「新的在前」的順序），一位藝人只算一次。
   * 藝人一有人分享，之後就會自然留在這份清單裡，不用手動維護。
   */
  recentSharedArtistSlugs = () =>
    this.#lazy("recentSharedArtistSlugs", () => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const s of this.shares) for (const slug of this.aboutSlugs(s)) if (!seen.has(slug)) {
          seen.add(slug);
          out.push(slug);
        }
      return out;
    });

  /**
   * 炫收藏表單「跟誰有關」的預設清單完整池（2026-09-28 表單藝人預設）：
   * 全站最近分享過的藝人（新到舊）→ 顏社／本色音樂旗下藝人（現任在前、前藝人在後），去重。
   * 不在這個池裡的藝人（其餘 200 多位）表單不會列出按鈕，只能靠打字搜尋（走 /api/artists/search）找到。
   */
  formArtistPool = () =>
    this.#lazy("formArtistPool", () => {
      const seen = new Set<string>();
      const slugs: string[] = [];
      for (const slug of this.recentSharedArtistSlugs()) if (!seen.has(slug)) {
          seen.add(slug);
          slugs.push(slug);
        }
      for (const slug of LABEL_FORCE_SLUGS) if (!seen.has(slug)) {
          seen.add(slug);
          slugs.push(slug);
        }
      return slugs.map((slug) => this.getArtist(slug)).filter((a): a is Artist => Boolean(a));
    });

  /**
   * 這位會員自己過去分享時「跟誰有關」點過的藝人 slug：新的在前，去重，最多 `limit` 位。
   * 這些藝人本來就會出現在 recentSharedArtistSlugs（自己分享過，全站也算），這裡只是把順序往前提。
   */
  memberRecentArtistSlugs = (handle: string, limit = 5) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of this.shares) {
      if (s.author !== handle) continue;
      for (const slug of this.aboutSlugs(s)) {
        if (seen.has(slug)) continue;
        seen.add(slug);
        out.push(slug);
        if (out.length >= limit) return out;
      }
    }
    return out;
  };

  /**
   * 表單用：預設清單（最多 10 位，會員自己最近選過的排最前面）＋「更多」按鈕展開的其餘藝人，
   * 加上每位藝人的系列＞品項＞版本（平面、可序列化）。
   * `viewerHandle` 沒登入就不傳，預設清單只靠全站近況與廠牌名單排序。
   */
  formOptions = (viewerHandle?: string, defaultCap = 10) => {
    const pool = this.formArtistPool();
    const memberRecent = viewerHandle ? this.memberRecentArtistSlugs(viewerHandle) : [];
    const bySlug = new Map(pool.map((a) => [a.slug, a]));
    const ordered: Artist[] = [];
    const seen = new Set<string>();
    for (const slug of memberRecent) {
      const a = bySlug.get(slug);
      if (a && !seen.has(slug)) {
        ordered.push(a);
        seen.add(slug);
      }
    }
    for (const a of pool) if (!seen.has(a.slug)) {
        ordered.push(a);
        seen.add(a.slug);
      }
    return {
      defaultArtists: ordered.slice(0, defaultCap).map(this.#formArtist),
      moreArtists: ordered.slice(defaultCap).map(this.#formArtist),
      series: this.seriesList.map((w) => ({
        key: seriesKey(w),
        name: w.name,
        title: w.title,
        kind: w.kind,
        year: w.year,
        credits: w.credits,
        items: w.items.map((it) => ({
          id: it.id,
          kind: it.kind,
          versions: it.versions.map((v) => ({ id: v.id, edition: v.edition, year: v.year, region: v.region, key: versionKey(w, it, v) })),
        })),
      })),
    };
  };
}

export type FormOptions = ReturnType<Catalog["formOptions"]>;

/** 批次發文的一張 */
export type BatchEntry = {
  key: string;
  label: string;
  about: string[];
  seriesKey: string;
  itemId?: string;
  versionId?: string;
  kind: string;
  /** 可以挑的類型（只有系列層才會有兩個以上） */
  kinds: string[];
  /** 系列層：類型 → 系列裡既有的品項 id（挑了有的就掛上去，沒有的伺服器自動建） */
  itemIds?: Record<string, string>;
};

/** 勾選用的系列（我收藏了哪些、合集標記、批次發文） */
export type PickSeries = {
  key: string;
  title: string;
  year: string;
  kind: string;
  artist: string;
  items: { id: string; kind: string; versions: { id: string; key: string; label: string }[] }[];
};

/**
 * 連結預覽用照片：有分享預覽圖（1200×630 JPEG，浮水印已燒進去，上線後雜項 2026-09-28）優先用那張；
 * 沒有的舊收藏退回縮圖（長邊 480px，尺寸由主圖尺寸等比例換算，大圖要登入才看得到，FB／LINE 的爬蟲沒有登入）。
 */
export function ogPhoto(s: Pick<Share, "og" | "thumb" | "image" | "imageSize">) {
  if (s.og) return { url: s.og, size: { w: 1200, h: 630 }, type: "image/jpeg" as const };
  const url = s.thumb ?? s.image;
  if (!url) return null;
  const size = s.imageSize;
  if (!size || !s.thumb) return { url };
  const k = Math.min(1, 480 / Math.max(size.w, size.h));
  return { url, size: { w: Math.round(size.w * k), h: Math.round(size.h * k) } };
}
