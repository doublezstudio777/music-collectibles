// SEO 伺服器端（2026-10-01）：讀後台覆寫、判斷收不收錄、組 metadata 與結構化資料。組字規則在 lib/seo.ts。
//
// 收錄判斷（第二層，自動把關）。條件每次渲染重算，條件一變頁面就跟著變（整頁快取鍵含內容版本；
// catalog_additions 沒有內容版本觸發器，確認新增後最多 5 分鐘生效，見 worker.ts 的 TTL）：
// - 系列頁：內容太空（沒有收藏、沒有任何版本有曲目、系列介紹不到 30 字；「周邊與其他」只看有沒有收藏）、
//   待確認的新增、後台設定不收錄 → noindex
// - 藝人頁：簡介不到 30 字、沒有收藏、底下沒有任何可收錄的主要系列 → 內容太空；待確認、後台設定 → noindex
// - 收藏頁：檢舉達門檻（被鎖＝交易暫停）、沒照片而且內容不到 10 字 → noindex
// - 已刪除、隱藏、審核中（status≠approved）的藝人、系列、版本、收藏：目錄讀不到，本來就 404
// - 設定、私訊、搜尋、願望清單（想要）、登入、後台、會員頁、標籤頁等私人或重複頁：proxy.ts 依網址加 X-Robots-Tag
// ALLOW_INDEXING≠1 時全站一律 noindex（layout.tsx＋proxy.ts），這裡的判斷只在開放收錄後才看得出差別。

import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import { cache } from "react";
import type { Catalog } from "@/lib/catalog";
import { isRecordKind, seriesHref, artistHref, shareHref, titleSegments, SERIES_KIND_LABEL, SITE_NAME, type Artist, type Series, type Share, type Version } from "@/lib/data";
import { indexingAllowed } from "@/lib/server/guard";
import { OG_DEFAULT } from "@/lib/server/og";
import { parseTracks, REGULAR_EDITION } from "@/lib/tracks";
import {
  CANONICAL_ORIGIN,
  clipWidth,
  DESC_MAX,
  DEFAULT_SITE_DESC,
  DEFAULT_TITLE_SUFFIX,
  oneLine,
  plainText,
  type SeoOverride,
  type SeoSite,
  type SeoTarget,
} from "@/lib/seo";

export type SeoContext = {
  site: SeoSite;
  overrides: Map<string, SeoOverride>;
  pending: { artist: Set<string>; series: Set<string>; version: Set<string> };
  /** 有曲目的系列（鍵 slug/no） */
  tracked: Set<string>;
};

const parse = <T,>(s: string | null | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

/** 一次 batch 讀完：後台覆寫（settings 的 seo:*）、待確認的新增、有曲目的系列 */
export const seoContext = cache(async (): Promise<SeoContext> => {
  const db = env.DB!;
  const [s, p, t] = await db.batch([
    db.prepare(`SELECT key, value FROM settings WHERE key >= 'seo:' AND key < 'seo;'`),
    db.prepare(
      `SELECT 'artist' AS t, ca.ref AS k FROM catalog_additions ca WHERE ca.type = 'artist' AND ca.confirmed_at IS NULL
       UNION ALL
       SELECT 'series', w.artist_slug || '/' || w.no FROM catalog_additions ca JOIN series w ON w.id = CAST(ca.ref AS INTEGER)
         WHERE ca.type = 'series' AND ca.confirmed_at IS NULL
       UNION ALL
       SELECT 'version', w.artist_slug || '/' || w.no || '#' || i.item_id || '-' || v.version_id
         FROM catalog_additions ca JOIN versions v ON v.id = CAST(ca.ref AS INTEGER) JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id
         WHERE ca.type = 'version' AND ca.confirmed_at IS NULL`,
    ),
    db.prepare(
      `SELECT DISTINCT w.artist_slug || '/' || w.no AS k FROM versions v
         JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id
       WHERE v.status = 'approved' AND v.deleted_at IS NULL AND v.hidden_at IS NULL
         AND i.deleted_at IS NULL AND i.hidden_at IS NULL
         AND ((v.track_list != '' AND v.track_list != '[]') OR (v.tracks != '' AND v.tracks != '—' AND v.tracks != '待查證'))`,
    ),
  ]);
  const rows = s.results as { key: string; value: string }[];
  const overrides = new Map<string, SeoOverride>();
  let site: SeoSite = { suffix: DEFAULT_TITLE_SUFFIX, description: DEFAULT_SITE_DESC };
  for (const r of rows) {
    const k = r.key.slice(4);
    if (k === "site") {
      const v = parse<Partial<SeoSite>>(r.value, {});
      site = { suffix: oneLine(v.suffix ?? "") || DEFAULT_TITLE_SUFFIX, description: oneLine(v.description ?? "") || DEFAULT_SITE_DESC };
    } else overrides.set(k, parse<SeoOverride>(r.value, {}));
  }
  const pending = { artist: new Set<string>(), series: new Set<string>(), version: new Set<string>() };
  for (const r of p.results as { t: keyof typeof pending; k: string }[]) pending[r.t]?.add(r.k);
  return { site, overrides, pending, tracked: new Set((t.results as { k: string }[]).map((r) => r.k)) };
});

export const overrideOf = (ctx: SeoContext, target: SeoTarget): SeoOverride => ctx.overrides.get(target) ?? {};
/** 覆寫值有填就用，沒填用自動的 */
export const pick = (custom: string | undefined, auto: string) => (custom && custom.trim() ? oneLine(custom) : auto);

/* ---------- 第二層：收不收錄 ---------- */

export type IndexDecision = { index: boolean; reason: string };
const YES: IndexDecision = { index: true, reason: "" };
const no = (reason: string): IndexDecision => ({ index: false, reason });
const textLen = (paras: string[]) => paras.join("").replace(/\s+/g, "").length;

/** 門檻（2026-10-01 提案）：簡介、系列介紹至少 30 字才算有內容；沒照片的收藏內容至少 10 字 */
export const THIN = { introChars: 30, bodyChars: 30, storyChars: 10 } as const;

const lockedShare = (c: Catalog, s: Share) => Boolean(c.toShareView(s).lock);

export function seriesIndex(c: Catalog, ctx: SeoContext, w: Series): IndexDecision {
  const key = `${w.artistSlug}/${w.no}`;
  if (overrideOf(ctx, `series:${key}`).noindex) return no("後台設定不收錄");
  if (ctx.pending.series.has(key)) return no("待確認的新增");
  const shares = c.sharesOfSeries(w).filter((s) => !lockedShare(c, s)).length;
  if (w.kind === "misc") return shares ? YES : no("內容太空：周邊與其他沒有收藏");
  if (shares || ctx.tracked.has(key) || textLen(w.body) >= THIN.bodyChars) return YES;
  return no("內容太空：沒有收藏、沒有曲目、介紹不到 30 字");
}

export function artistIndex(c: Catalog, ctx: SeoContext, a: Artist): IndexDecision {
  if (overrideOf(ctx, `artist:${a.slug}`).noindex) return no("後台設定不收錄");
  if (ctx.pending.artist.has(a.slug)) return no("待確認的新增");
  if (textLen(a.intro) >= THIN.introChars) return YES;
  if (c.sharesWithTag(a.name).some((s) => !lockedShare(c, s))) return YES;
  if (c.mainSeriesOf(a.slug).some((w) => seriesIndex(c, ctx, w).index)) return YES;
  return no("內容太空：沒有簡介、沒有收藏、沒有可收錄的系列");
}

export function shareIndex(c: Catalog, s: Share): IndexDecision {
  if (lockedShare(c, s)) return no("檢舉達門檻，交易暫停");
  if (!s.thumb && !s.image && oneLine(s.story).length < THIN.storyChars) return no("內容太空：沒有照片、內容不到 10 字");
  return YES;
}


/* ---------- 第一層：自動標題與描述（頁面與後台預覽共用） ---------- */

type VersionLines = Map<string, { lines: string[] }>;

/**
 * 系列的代表曲目：一般版（版本名稱有「一般版／標準版」）的曲目；判斷不出來就用最早的實體版本（依發行日期、年份）。
 * 只看有曲目的版本（2026-10-01 從系列頁搬來，後台 SEO 預覽也要用）
 */
export function mainTracks(series: Series, tracks: VersionLines) {
  const all = series.items
    .flatMap((it) => it.versions.map((v, i) => ({ it, v, i, lines: tracks.get(`${it.id}-${v.id}`)?.lines ?? [] })))
    .filter((x) => x.lines.length);
  const regular = all.find((x) => REGULAR_EDITION.test(x.v.edition));
  if (regular) return { ...regular, regular: true };
  const when = (v: Version) => v.releaseDate || v.year || "9999";
  const first = [...all].sort((a, b) => when(a.v).localeCompare(when(b.v)))[0];
  return first ? { ...first, regular: false } : null;
}

export function seriesTitle(c: Catalog, w: Series) {
  const who = c.creditNames(w).map((a) => a.name).join("、");
  if (w.kind === "misc") return `${who}的周邊與其他｜收藏`;
  const all = w.items.flatMap((it) => it.versions.map((v) => ({ it, v })));
  const tail = w.kind === "tour" || w.kind === "brand" ? "周邊、版本與收藏" : "曲目、版本與收藏";
  const one = all.length === 1 ? titleSegments("", all[0].it.kind, all[0].v.edition).join(" ") : "";
  const year = /^\d{4}/.test(w.year) ? `${w.year.slice(0, 4)} ` : "";
  return `${who}《${w.title}》${one || `${year}${SERIES_KIND_LABEL[w.kind]}`}｜${tail}`;
}

export function seriesDescription(c: Catalog, w: Series, nTracks: number) {
  const who = c.creditNames(w).map((a) => a.name).join("、");
  const n = w.items.reduce((k, it) => k + it.versions.length, 0);
  const kinds = Array.from(new Set(w.items.map((i) => i.kind))).join("、");
  const shares = c.sharesOfSeries(w).length;
  const year = /^\d{4}/.test(w.year) ? `，${w.year.slice(0, 4)}年發行的${SERIES_KIND_LABEL[w.kind]}` : "";
  const facts = [n ? `${n}個版本${kinds ? `（${kinds}）` : ""}` : "", nTracks ? `${nTracks}首曲目` : "", shares ? `${shares}則樂迷收藏` : ""].filter(Boolean).join("、");
  const head = w.kind === "misc" ? `${who}的周邊與其他` : `${who}《${w.title}》${year}`;
  return clipWidth(`${head}。${facts ? `收錄${facts}。` : ""}${plainText(w.body.join(" "))}`, DESC_MAX);
}


export function artistTitle(a: Artist) {
  return `${a.name}｜${a.kind === "發行單位" ? "發行作品與收藏" : "專輯、版本與收藏"}`;
}

export function artistDescription(c: Catalog, a: Artist) {
  const series = c.mainSeriesOf(a.slug).length;
  const shares = c.sharesWithTag(a.name).length;
  const head = a.tagline ? `${a.name}，${oneLine(a.tagline)}。` : `${a.name}。`;
  const stats = [series ? `${series}個系列` : "", shares ? `${shares}則樂迷收藏` : ""].filter(Boolean).join("、");
  const intro = plainText(a.intro.join(""));
  return clipWidth(`${head}${stats ? `${SITE_NAME}收錄${stats}。` : ""}${intro}`, DESC_MAX);
}

/* ---------- 第一層：metadata ---------- */

type ImgType = "image/jpeg" | "image/webp" | "image/png";
export type SeoPhoto = { url: string; size?: { w: number; h: number }; type?: ImgType } | null;

export const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${CANONICAL_ORIGIN}${path}`);

/** 後台上傳的 og 圖（R2 g/，1200×630 JPEG） */
export const overridePhoto = (o: SeoOverride): SeoPhoto => (o.og ? { url: `/img/${o.og}`, size: { w: 1200, h: 630 }, type: "image/jpeg" } : null);

/**
 * 每頁的 metadata：title（layout 的 template 接後綴；absolute＝首頁不接）、description、canonical（固定正式網域）、og、twitter、robots。
 * robots：沒開放收錄一律 noindex（跟 layout 同一個字串，deploy.sh 煙霧測試比對 content="noindex"）；開放後依 index 判斷
 */
export function seoMeta({
  path,
  title,
  description,
  photo,
  index = true,
  absolute = false,
  type = "website",
  alt,
}: {
  path: string;
  title: string;
  description: string;
  photo: SeoPhoto;
  index?: boolean;
  absolute?: boolean;
  type?: "website" | "article";
  alt?: string;
}): Metadata {
  const url = abs(path);
  const img = photo ?? OG_DEFAULT;
  const image = {
    url: abs(img.url),
    ...(img.size ? { width: img.size.w, height: img.size.h } : {}),
    ...(img.type ? { type: img.type } : {}),
    alt: photo ? (alt ?? title) : DEFAULT_TITLE_SUFFIX,
  };
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: { type, siteName: DEFAULT_TITLE_SUFFIX, locale: "zh_TW", title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
    ...(!indexingAllowed() || !index ? { robots: { index: false } } : {}),
  };
}

/* ---------- 結構化資料 ---------- */

type Ld = Record<string, unknown>;

/** 放進 <script type="application/ld+json">：跳脫 <，避免內容裡的 </script> 提早結束 */
export const ldJson = (graph: Ld[]) => JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");

export function breadcrumbLd(trail: { name: string; path: string }[]): Ld {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: abs(t.path) })),
  };
}

/** 藝人：男女歌手＝Person，團體與未分類＝MusicGroup，發行單位＝Organization */
export const artistType = (a: Artist) => (a.kind === "發行單位" ? "Organization" : a.gender === "male" || a.gender === "female" ? "Person" : "MusicGroup");
const artistRef = (a: Artist): Ld => ({ "@type": artistType(a), "@id": `${abs(artistHref(a.slug))}#artist`, name: a.name, url: abs(artistHref(a.slug)) });

const ALBUM_TYPE: Partial<Record<Series["kind"], string>> = { album: "AlbumRelease", ep: "EPRelease", single: "SingleRelease" };
const FORMAT: Record<string, string> = { CD: "CDFormat", 黑膠: "VinylFormat", 卡帶: "CassetteFormat", "藍光／DVD": "DVDFormat" };
/** 「3:45」→「PT3M45S」 */
const isoDuration = (len: string) => {
  const m = len.match(/^(\d{1,3}):(\d{2})$/);
  return m ? `PT${Number(m[1])}M${Number(m[2])}S` : undefined;
};
const isDate = (s: string) => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s);

export function artistLd(c: Catalog, ctx: SeoContext, a: Artist, image: string | null): Ld {
  const albums = a.kind === "發行單位" ? [] : c.mainSeriesOf(a.slug).filter((w) => ALBUM_TYPE[w.kind] && seriesIndex(c, ctx, w).index);
  const desc = oneLine(a.tagline || a.intro[0] || "");
  return {
    ...artistRef(a),
    ...(a.aliases.length ? { alternateName: a.aliases } : {}),
    ...(desc ? { description: desc } : {}),
    ...(image ? { image: abs(image) } : {}),
    ...(a.wiki ? { sameAs: [a.wiki.url] } : {}),
    ...(artistType(a) === "MusicGroup" && albums.length
      ? { album: albums.map((w) => ({ "@type": "MusicAlbum", "@id": `${abs(seriesHref(w))}#album`, name: w.title, url: abs(seriesHref(w)) })) }
      : {}),
  };
}

/**
 * 系列頁：專輯、EP、單曲＝MusicAlbum；每個實體唱片版本（CD、黑膠、卡帶、藍光／DVD）＝MusicRelease（版本沒有獨立網址，
 * 用系列頁＋版本錨點當 url 與 @id）。巡迴、自有品牌、周邊不是唱片，不出 MusicAlbum。
 * 目錄號、條碼屬於登入後才看得到的辨識細節，不放進結構化資料。待確認的版本不列。
 */
export function seriesLd(
  c: Catalog,
  ctx: SeoContext,
  w: Series,
  opts: { image: string | null; description: string; tracks: Map<string, { lines: string[] }>; mainLines: string[] },
): Ld | null {
  const releaseType = ALBUM_TYPE[w.kind];
  if (!releaseType) return null;
  const url = abs(seriesHref(w));
  const key = `${w.artistSlug}/${w.no}`;
  const artists = c.creditNames(w);
  const discs = parseTracks(opts.mainLines);
  const tracks = discs.flatMap((d) => d.tracks);
  const releases = w.items
    .filter((it) => isRecordKind(it.kind))
    .flatMap((it) =>
      it.versions
        .filter((v) => !ctx.pending.version.has(`${key}#${it.id}-${v.id}`))
        .map((v) => {
          const date = v.releaseDate || v.year;
          const n = parseTracks(opts.tracks.get(`${it.id}-${v.id}`)?.lines ?? []).reduce((k, d) => k + d.tracks.length, 0);
          return {
            "@type": "MusicRelease",
            "@id": `${url}#${it.id}-${v.id}`,
            url: `${url}#${it.id}-${v.id}`,
            name: `${w.title} ${v.edition}`.trim(),
            musicReleaseFormat: `https://schema.org/${FORMAT[it.kind] ?? "CDFormat"}`,
            releaseOf: { "@id": `${url}#album` },
            ...(isDate(date) ? { datePublished: date } : {}),
            ...(v.label && v.label !== "—" && v.label !== "待查證" ? { recordLabel: { "@type": "Organization", name: v.label } } : {}),
            ...(n ? { numTracks: n } : {}),
            ...(v.mbid ? { sameAs: [`https://musicbrainz.org/release/${v.mbid}`] } : {}),
          };
        }),
    );
  return {
    "@type": "MusicAlbum",
    "@id": `${url}#album`,
    name: w.title,
    url,
    albumReleaseType: `https://schema.org/${releaseType}`,
    ...(artists.length ? { byArtist: artists.map(artistRef) } : {}),
    ...(isDate(w.year) ? { datePublished: w.year } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.image ? { image: abs(opts.image) } : {}),
    ...(tracks.length
      ? {
          numTracks: tracks.length,
          track: tracks.map((t, i) => ({
            "@type": "MusicRecording",
            name: t.title,
            position: i + 1,
            ...(isoDuration(t.length) ? { duration: isoDuration(t.length) } : {}),
          })),
        }
      : {}),
    ...(releases.length ? { albumRelease: releases } : {}),
    ...(w.mbid ? { sameAs: [`https://musicbrainz.org/release-group/${w.mbid}`] } : {}),
  };
}

/** 麵包屑：首頁 › 藝人 › 某藝人 › 系列 › 收藏 */
export const HOME_CRUMB = { name: "首頁", path: "/" };
export const ARTISTS_CRUMB = { name: "藝人", path: "/artists" };
export const artistCrumb = (a: Artist) => ({ name: a.name, path: artistHref(a.slug) });
export const seriesCrumb = (w: Series) => ({ name: w.title, path: seriesHref(w) });
export const shareCrumb = (n: number, name: string) => ({ name, path: shareHref(n) });
