// 內容目錄：藝人、系列、品項、版本、炫收藏，加上檢舉鎖定資料。
// 伺服器端由 lib/server/content.ts 從 D1 讀出來組成；這支是純函式，不碰資料庫。
//
// 幾條規則寫在這裡，頁面不自己判斷：
// - 共同署名系列：credits 列出所有署名藝人，每位的藝人頁都列為主要作品；資料只有一筆
// - 合作與客串、合輯收錄另外記，不算進對方的主要作品
// - 標籤與藝人名（或別名）撞名時，resolveTagArtist 會找到那位藝人，標籤頁與藝人頁的
//   「相關收藏」用同一份資料

import {
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
  type Artist,
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

  getArtist = (slug: string) => this.artists.find((a) => a.slug === slug);

  /**
   * 藝人頁對外顯示嗎（2c）：沒有任何系列（主要、客串、合輯）也沒有任何相關收藏就不顯示，
   * 直接打網址回 404。管理員可強制開（on）或關（off）。名單可以先匯入，等有人發了收藏才自動出現。
   */
  artistVisible = (a: Artist) => {
    if (a.display === "on") return true;
    if (a.display === "off") return false;
    return (
      this.mainSeriesOf(a.slug).length > 0 ||
      this.guestSeriesOf(a.slug).length > 0 ||
      this.compilationsOf(a.slug).length > 0 ||
      this.sharesWithTag(a.name).length > 0
    );
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
  getShare = (n: number) => this.shares.find((s) => s.n === n);
  getSeriesByKey = (key: string) => this.seriesList.find((w) => seriesKey(w) === key);
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
  resolveTagArtist = (tag: string) => {
    const t = norm(tag);
    return this.artists.find((a) => norm(a.name) === t || a.aliases.some((x) => norm(x) === t));
  };

  /** 合流用的標籤鍵：撞名的一律算成同一位藝人 */
  tagKey = (tag: string) => {
    const artist = this.resolveTagArtist(tag);
    return artist ? `artist:${artist.slug}` : `tag:${norm(tag)}`;
  };

  shareHasTag = (share: Pick<Share, "about" | "tags">, tag: string) => {
    const key = this.tagKey(tag);
    return [...share.about, ...share.tags].some((t) => this.tagKey(t) === key);
  };

  sharesWithTag = (tag: string) => this.shares.filter((s) => this.shareHasTag(s, tag));

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
      ...(s.refPhoto ? { refPhoto: true } : {}),
      story: s.story,
      time: s.time,
      order: s.order,
      about: s.about,
      tags: s.tags,
      likes: s.likes,
      color: s.color,
      ...(s.image ? { image: s.image } : {}),
      ...(s.thumb ? { thumb: s.thumb } : {}),
      author: { handle: s.author, name, initials: Array.from(name)[0] ?? "?" },
      ...(link ? { link } : {}),
      sale: s.sale ?? { state: "share" },
      aboutSlugs: this.aboutSlugs(s),
      hasFakes: this.linkHasFakes(link),
      lock: lockFor(this.lockData, s.n, link),
    };
  };

  allShareViews = () => this.shares.map(this.toShareView);

  toHoldingView = (key: string): HoldingView | null => {
    const r = this.resolveVersionKey(key);
    if (!r) return null;
    return {
      key,
      title: r.series.title,
      artists: this.creditNames(r.series).map((a) => a.name).join("、"),
      edition: r.version.edition,
      year: r.version.year,
      format: r.item.kind,
      catalog: r.version.catalog,
      href: versionHref(r.series, r.item, r.version),
      color: r.version.color,
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
      sources.push({ title: `跟${a.name}有關的其他收藏`, href: tagHref(a.name), match: (s) => this.shareHasTag(s, t), scope: { tag: a.name } });
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

  /** 熱門藝人：相關收藏多的在前，只列藝人不列發行單位。多給幾位，按了不感興趣由下一位補上 */
  hotArtists = (limit = 30) =>
    this.artists
      .filter((a) => a.kind === "藝人" && this.artistVisible(a))
      .map((a) => ({ slug: a.slug, name: a.name, count: this.sharesWithTag(a.name).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

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

  /** 表單用：每位藝人的系列＞品項＞版本（平面、可序列化） */
  formOptions = () => ({
    artists: this.artists.map((a) => ({
      slug: a.slug,
      name: a.name,
      aliases: a.aliases,
      kind: a.kind,
      gender: a.gender ?? null,
      region: a.region ?? null,
    })),
    series: this.seriesList.map((w) => ({
      key: seriesKey(w),
      name: w.name,
      title: w.title,
      credits: w.credits,
      items: w.items.map((it) => ({
        id: it.id,
        kind: it.kind,
        versions: it.versions.map((v) => ({ id: v.id, edition: v.edition, key: versionKey(w, it, v) })),
      })),
    })),
  });
}

export type FormOptions = ReturnType<Catalog["formOptions"]>;
