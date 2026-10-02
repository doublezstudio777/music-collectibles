import Link from "@/components/link";
import { notFound } from "next/navigation";
import {
  artistHref,
  isTargetLocked,
  itemAnchor,
  itemKey,
  itemTarget,
  shareHref,
  versionAnchor,
  versionKey,
  versionTarget,
  seriesKey,
  SERIES_KIND_LABEL,
  type Item,
  type LockData,
  type Series,
  type Share,
  type ShareView,
  type Version,
} from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { cache } from "react";
import {
  ARTISTS_CRUMB,
  HOME_CRUMB,
  artistCrumb,
  breadcrumbLd,
  ldJson,
  mainTracks,
  overrideOf,
  overridePhoto,
  pick,
  seoContext,
  seoMeta,
  seriesCrumb,
  seriesDescription,
  seriesFacts,
  seriesIndex,
  seriesLd,
  seriesMarket,
  seriesTitle,
} from "@/lib/server/seo";
import { seriesIntro } from "@/lib/series-intro";
import { MarketBox, VersionTable } from "@/components/series-facts";
import { CopyLink } from "@/components/share-actions";
import { HoldingButtons, OwnersCount } from "@/components/holding-buttons";
import { PriceHistory } from "@/components/price-history";
import { WikiEditor } from "@/components/wiki-editor";
import { priceSummaries } from "@/lib/server/prices";
import { isLocked, lastEdit, latestRevisionId, loadPage, targetKey, type WikiTarget } from "@/lib/server/wiki";
import { seriesTracks, type VersionTracks } from "@/lib/server/tracks";
import { diffText, diffTracks, parseTracks, trackCount } from "@/lib/tracks";
import type { PriceSummary } from "@/lib/prices";
import { LockBanner, ReportBox } from "@/components/report";
import { ItemLooseWall, ShareWall, VersionWall } from "@/components/share-wall";
import { IdentifyDetails } from "@/components/identify-details";
import { SeriesTile } from "@/components/work-cover";
import { seriesContributors } from "@/lib/server/contributors";
import { Ava } from "@/components/ava";
import { LevelTag } from "@/components/level-tag";
import { YearFill } from "@/components/year-fill";
import { FieldFill } from "@/components/field-fill";
import { FillLink } from "@/components/fill-link";
import { FILL_FIELDS, isBlank, type FillField } from "@/lib/fill";

type Props = { params: Promise<{ artist: string; no: string }>; searchParams?: Promise<{ edit?: string }> };

// 辨識特徵、目錄號、條碼屬於辨識細節（2026-09-28 防盜版批次）：登入會員才看得到，
// 不放進公開頁面（整頁快取訪客與會員同一份），改由 IdentifyDetails 從 /api/details 取。
// 2026-10-02 設計總檢：品項裡的多欄比較表（Compare）與單一版本規格清單（Spec）拿掉，
// 版本欄位一律在頁面上方的「版本比較」表（components/series-facts.tsx），一張表、同一套列高規則

/** 公開頁面上可以補的空白欄位（目錄號、辨識特徵在登入後的辨識細節補；曲目改在版本的「曲目」區塊逐首補，2026-09-28） */
const PUBLIC_FILL = (Object.keys(FILL_FIELDS) as FillField[]).filter(
  (k): k is "year" | "region" | "label" | "packaging" | "contents" => FILL_FIELDS[k].public && k !== "tracks",
);


function TrackList({ lines }: { lines: string[] }) {
  const discs = parseTracks(lines);
  return (
    <div className="tracklist-wrap">
      {discs.map((d, i) => (
        <div key={i} className="disc">
          {discs.length > 1 || d.title ? <p className="disc-title">{d.title || `第 ${i + 1} 碟`}</p> : null}
          <ol className="tracklist">
            {d.tracks.map((t, j) => (
              <li key={j}>
                <span className="t-no">{t.no}</span>
                <span className="t-title">{t.title}</span>
                <span className="t-len">{t.length}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

async function load(params: Props["params"]) {
  const { artist, no } = await params;
  const { c } = await pageData();
  return { c, series: c.getSeries(artist, Number(no)) };
}

// 系列頁 metadata（2026-10-01 SEO）：
// - 標題：只有一個版本「理想混蛋《關掉／打開》2022 台灣首版 CD｜曲目、版本與收藏」；多個版本「Hyukoh《23》2017 專輯｜曲目、版本與收藏」
// - 描述：自動事實句（lib/series-intro.ts：誰、哪一年、幾首、版本與地區、收藏與願望清單人數、出售中件數，不含價格），再接系列介紹開頭
// - 版本沒有獨立網址（系列頁的錨點），版本的 MusicRelease 放在這頁的結構化資料裡
// 後台可覆寫；內容太空、待確認、後台設定不收錄時 noindex（lib/server/seo.ts）
const tracksOf = cache(seriesTracks);

export async function generateMetadata({ params }: Props) {
  const [{ c, series: w }, ctx] = await Promise.all([load(params), seoContext()]);
  if (!w) return { title: "找不到系列" };
  const o = overrideOf(ctx, `series:${w.artistSlug}/${w.no}`);
  const tracks = await tracksOf(w.artistSlug, w.no);
  return seoMeta({
    path: `/artist/${w.artistSlug}/${w.no}`,
    title: pick(o.title, seriesTitle(c, w)),
    description: pick(o.description, seriesDescription(c, w, tracks)),
    photo: overridePhoto(o) ?? c.ogPhotoOf(c.sharesOfSeries(w)),
    index: seriesIndex(c, ctx, w).index,
    alt: `${c.creditNames(w).map((a) => a.name).join("、")}《${w.title}》`,
  });
}

function VersionBlock({
  series,
  item,
  v,
  related,
  view,
  locks,
  price,
  tracks,
  editor,
  collections = 0,
  base,
  first,
}: {
  series: Series;
  item: Item;
  v: Version;
  /** 這個版本被標在幾個合集裡（2026-10-01） */
  collections?: number;
  /** 曲目比較的基準版本（主曲目那一版）；2026-10-02 曲目差異改寫在這裡，不放表格 */
  base: { v: Version; lines: string[] } | null;
  /** 品項裡的第一個版本：訪客的「登入後查看辨識細節」只在這裡出現一次（2026-10-02 建議 18） */
  first: boolean;
  related: Share[];
  view: (s: Share) => ShareView;
  locks: LockData;
  price?: PriceSummary;
  tracks?: VersionTracks;
  /** 這個版本的曲目正在編輯（?edit=tracks:{錨點}） */
  editor?: { baseId: number; locked: boolean } | null;
}) {
  const list = related.filter((s) => s.link?.version === v.id);
  // 正版辨識照片：只列管理員標為「辨識參考」的（2026-09-28 起會員不能自己勾）
  const refs = list.flatMap((s) => (s.refPhotos ?? []).map((p, i) => ({ s, p, i })));
  const vkey = versionKey(series, item, v);
  const locked = isTargetLocked(locks, versionTarget(vkey));
  const lines = tracks?.lines ?? [];
  const blanks = PUBLIC_FILL.filter((f) => isBlank(f, v[f]));
  // 沒資料的版本（沒曲目、沒行情、沒參考照片、沒收藏、沒被鎖、不在編輯）收成一列：補資料＋檢舉（2026-10-02 建議 18）
  const lite = !lines.length && !price && !refs.length && !list.length && !locked && !editor && !v.fakes?.length;
  const anchor = versionAnchor(item, v);
  const self = `/artist/${seriesKey(series)}`;
  const tracksEditHref = `${self}?edit=${encodeURIComponent(`tracks:${anchor}`)}#${anchor}`;
  return (
    <section id={anchor} className={lite ? "ver-block is-lite" : "ver-block"} data-lite={lite ? "true" : undefined}>
      <div className="ver-head">
        <h3 className="ver-title">
          {v.edition}
          {v.fakes?.length ? <span className="flag flag-fake">有已知仿冒</span> : null}
          <OwnersCount vkey={vkey} owners={v.owners} />
          {collections ? (
            <a className="ver-collections" href="#collections" data-testid="ver-collections">
              出現在 <span className="num">{collections}</span> 個合集中
            </a>
          ) : null}
        </h3>
        {/* 我有／願望清單原本在比較表的表頭，表拿掉後移到版本標題旁 */}
        <HoldingButtons vkey={vkey} owners={v.owners} wanted={v.wanted} />
      </div>
      <LockBanner target={versionTarget(vkey)} locked={locked} />
      {lite ? (
        <div className="ver-lite" data-testid="ver-lite">
          <FieldFill vkey={vkey} fields={blanks} />
          <p className="fill-row">
            <span className="fill-label">曲目待補</span>
            <FillLink href={tracksEditHref} testid="tracks-edit" />
          </p>
          <IdentifyDetails skey={seriesKey(series)} vkey={vkey} anchor={anchor} hasFakes={false} gate={first} compact />
          <ReportBox target={versionTarget(vkey)} label="檢舉這個版本" />
        </div>
      ) : (
        <>
      <FieldFill vkey={vkey} fields={blanks} />

      {price ? <PriceHistory summary={price} /> : null}

      <VersionTracksBlock series={series} anchor={anchor} vkey={vkey} t={tracks} editor={editor ?? null} base={base && base.v !== v ? base : null} />

      <IdentifyDetails skey={seriesKey(series)} vkey={vkey} anchor={anchor} hasFakes={Boolean(v.fakes?.length)} gate={first} />
      {refs.length ? (
        <div className="refs">
          <span className="refs-label">辨識參考照片</span>
          <ul className="refs-list">
            {refs.map(({ s, p, i }) => (
              <li key={`${s.n}-${i}`}>
                <Link href={shareHref(s.n)} className="ref-thumb" aria-label={s.what} data-testid="ref-photo">
                  <span className="ref-img" style={{ backgroundImage: `url(${p.thumb})` }} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 0 則就不畫標題與「還沒有人炫過」（2026-10-02 建議 18） */}
      {list.length ? (
        <>
          <h4 className="sub-title">
            炫收藏<span className="count">{list.length}</span>
          </h4>
          <VersionWall shares={list.map(view)} confirmed={v.status === "已確認"} id={anchor} />
        </>
      ) : null}
      <ReportBox target={versionTarget(vkey)} label="檢舉這個版本" />
        </>
      )}
    </section>
  );
}

/** 版本的曲目：可收合，多碟分開列；來源與修改者；編輯走維基式編輯（target＝tracks:{版本鍵}） */
function VersionTracksBlock({
  series,
  anchor,
  vkey,
  t,
  editor,
  base,
}: {
  series: Series;
  anchor: string;
  vkey: string;
  t?: VersionTracks;
  editor: { baseId: number; locked: boolean } | null;
  /** 主曲目那一版（不是自己時才給）：曲目不同就寫一句「跟某版相比：多了〈XX〉」 */
  base: { v: Version; lines: string[] } | null;
}) {
  const lines = t?.lines ?? [];
  const diff = base && lines.length && base.lines.length ? diffTracks(base.lines, lines) : null;
  const n = trackCount(lines);
  const self = `/artist/${seriesKey(series)}`;
  const editHref = `${self}?edit=${encodeURIComponent(`tracks:${anchor}`)}#${anchor}`;
  // 沒有曲目（2026-09-29）：不收合，直接在欄位旁放「補上」
  if (!lines.length && !editor) {
    return (
      <div className="tracks tracks-blank" data-testid="version-tracks">
        <p className="fill-row">
          <span className="fill-label">曲目待補</span>
          <FillLink href={editHref} testid="tracks-edit" />
          <Link className="link sub" href={`${self}/history?tracks=${encodeURIComponent(anchor)}`}>
            歷史
          </Link>
        </p>
      </div>
    );
  }
  return (
    <details className="tracks" data-testid="version-tracks" open={editor ? true : undefined}>
      <summary>
        曲目
        {n ? <span className="count">{n}</span> : <span className="sub tracks-none">還沒有</span>}
      </summary>
      {diff && !diff.same ? (
        <p className="tracks-diff" data-testid="track-diff">
          跟「{base!.v.edition}」相比：{diffText(diff)}
        </p>
      ) : null}
      {editor ? (
        <WikiEditor target={`tracks:${vkey}`} paras={lines} baseId={editor.baseId} locked={editor.locked} closeHref={`${self}#${anchor}`} label="曲目" lines />
      ) : lines.length ? (
        <TrackList lines={lines} />
      ) : (
        <p className="sub tracks-empty">還沒有人補上曲目</p>
      )}
      <p className="edit-line tracks-src" data-testid="tracks-source">
        {t?.mbid && lines.length ? (
          <>
            來源：
            <a className="link" href={`https://musicbrainz.org/release/${t.mbid}`} target="_blank" rel="noopener noreferrer">
              MusicBrainz
            </a>
            <span className="dot" aria-hidden="true">·</span>
          </>
        ) : null}
        {t?.editedBy ? (
          <>
            {t.editedBy.handle ? (
              <Link className="link" href={`/u/${t.editedBy.handle}`}>
                {t.editedBy.name}
              </Link>
            ) : (
              t.editedBy.name
            )}{" "}
            修改於 {t.editedBy.date}
            <span className="dot" aria-hidden="true">·</span>
          </>
        ) : null}
        <Link className="link" href={editHref} data-testid="tracks-edit">
          {lines.length ? "編輯曲目" : "補上曲目"}
        </Link>
        <span className="dot" aria-hidden="true">·</span>
        <Link className="link" href={`${self}/history?tracks=${encodeURIComponent(anchor)}`}>
          歷史
        </Link>
      </p>
    </details>
  );
}

export default async function SeriesPage({ params, searchParams }: Props) {
  const { c, series } = await load(params);
  if (!series) notFound();
  const editParam = (await searchParams)?.edit ?? "";
  const editing = editParam === "1";
  // 曲目編輯：?edit=tracks:{品項}-{版本}
  const tm = editParam.match(/^tracks:([^#-]{1,40})-([^#-]{1,40})$/);
  const tt: WikiTarget | null = tm ? { kind: "tracks", slug: series.artistSlug, no: series.no, item: tm[1], version: tm[2] } : null;
  const wt = { kind: "series" as const, slug: series.artistSlug, no: series.no };
  const skey = `${series.artistSlug}/${series.no}`;
  const lockedShares = new Set(c.sharesOfSeries(series).filter((s) => c.toShareView(s).lock).map((s) => s.n));
  const [page, pageLocked, edited, baseId, prices, contributors, tracks, tracksLocked, tracksBase] = await Promise.all([
    editing ? loadPage(wt) : null,
    editing ? isLocked(wt) : false,
    lastEdit(wt),
    editing ? latestRevisionId(`series:${skey}`) : 0,
    priceSummaries(skey, lockedShares),
    seriesContributors(series.artistSlug, series.no),
    tracksOf(series.artistSlug, series.no),
    tt ? isLocked(tt) : false,
    tt ? latestRevisionId(targetKey(tt)) : 0,
  ]);
  const main = mainTracks(series, tracks);
  const self = `/artist/${skey}`;
  const lastBy = edited ?? series.lastEdit;

  const credits = c.creditNames(series);
  const related = c.sharesOfSeries(series);
  const versions = series.items.flatMap((i) => i.versions);
  // 「有，但不確定版本」的也算（2026-10-01 一次勾選我有）
  const owners = versions.reduce((n, v) => n + v.owners, 0) + (series.looseOwners ?? 0);
  // 被標在哪些全家福合集裡（2026-10-01）：系列頁內連回合集
  const collections = c.collectionsOf(series);
  // 這位藝人的其他系列：共同署名的每位各一區；隱藏、待審的系列本來就不在目錄裡。依發行年（舊到新，沒填年份的放最後）
  const yearOf = (w: Series) => (/^\d{4}$/.test(w.year) ? Number(w.year) : 9999);
  const selfCover = c.seriesCover(series);
  const otherSeries = credits
    .map((a) => ({
      artist: a,
      list: c
        .mainSeriesOf(a.slug)
        .filter((w) => seriesKey(w) !== skey)
        .sort(
          (x, y) =>
            (x.kind === "misc" ? 1 : 0) - (y.kind === "misc" ? 1 : 0) ||
            yearOf(x) - yearOf(y) ||
            x.artistSlug.localeCompare(y.artistSlug) ||
            x.no - y.no,
        ),
    }))
    .filter((g) => g.list.length > 0);
  // 放進願望清單的人（2026-10-01 統一）：想要任一版本 ∪ 對這個系列的收藏按愛心，同一人只算一次（lib/server/content.ts）
  const wishers = series.wishers ?? 0;

  // 結構化資料（2026-10-01 SEO）：MusicAlbum＋各版本 MusicRelease、麵包屑
  const ctx = await seoContext();
  const leadArtist = credits.find((a) => c.artistVisible(a));
  const album = seriesLd(c, ctx, series, {
    image: selfCover,
    description: seriesDescription(c, series, tracks),
    tracks,
    mainLines: main?.lines ?? [],
  });
  // 自動介紹句、版本比較、站上行情（2026-10-01 系列頁全部收錄）
  const facts = seriesFacts(c, series, tracks);
  const intro = seriesIntro(facts);
  const market = seriesMarket(c, series);
  const ld = ldJson([
    ...(album ? [album] : []),
    breadcrumbLd([HOME_CRUMB, ARTISTS_CRUMB, ...(leadArtist ? [artistCrumb(leadArtist)] : []), seriesCrumb(series)]),
  ]);

  return (
    <main id="main" className="wrap page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="work-head">
        {selfCover ? (
          <span className="cover cover-lg cover-photo" aria-hidden="true" style={{ backgroundImage: `url(${selfCover})` }} />
        ) : (
          <span className="cover cover-lg" aria-hidden="true" />
        )}
        <div className="work-head-text">
          <p className="credits">
            {credits.map((a, i) => (
              <span key={a.slug}>
                {i > 0 ? "、" : null}
                {c.artistVisible(a) ? (
                  <Link className="link" href={artistHref(a.slug)}>
                    {a.name}
                  </Link>
                ) : (
                  a.name
                )}
              </span>
            ))}
          </p>
          <h1 className="page-title">{series.name}</h1>
          <p className="series-kind">
            <span className="kind-tag" data-series-kind={series.kind} data-testid="series-kind">
              {SERIES_KIND_LABEL[series.kind]}
            </span>
            {series.kind === "misc" ? <span className="sub">不屬於專輯、也不屬於演唱會的周邊</span> : null}
          </p>
          <p className="page-meta">
            {/* 每一段不拆字（2026-10-02 建議 18：手機「1 則炫收藏」斷成「炫／收藏」） */}
            <span className="stat">
              <span className="num">{owners}</span> 人有
            </span>
            {" · "}
            <span className="stat">
              <span className="num">{wishers}</span> 人放進願望清單
            </span>
            {" · "}
            <span className="stat">
              <span className="num">{related.length}</span> 則炫收藏
            </span>
            {collections.length ? (
              <>
                {" · "}
                <a className="link stat" href="#collections" data-testid="series-collections-count">
                  出現在 <span className="num">{collections.length}</span> 個合集中
                </a>
              </>
            ) : null}
          </p>
          {/^\d{4}/.test(series.year) || series.kind === "misc" ? null : <YearFill skey={skey} />}
        </div>
        {/* 2026-10-02 建議 3：跟藝人頁一樣，複製連結、編輯、歷史是一列小文字連結，不佔手機一整排 */}
        <div className="head-actions series-acts">
          <p className="series-sub-acts">
            <CopyLink className="link-btn" />
            <Link className="link-btn" href={`${self}?edit=1#body`} data-testid="edit-link">
              編輯
            </Link>
            <Link className="link-btn" href={`${self}/history`}>
              歷史
            </Link>
          </p>
        </div>
      </header>

      <nav className="item-index" aria-label="品項">
        {series.items.map((it) => {
          const n = related.filter((s) => s.link?.item === it.id).length;
          return (
            <a key={it.id} className="item-link" href={`#${itemAnchor(it)}`}>
              <b>{it.kind}</b>
              <span className="sub">
                {it.versions.length} 個版本 · {n} 則
              </span>
            </a>
          );
        })}
      </nav>

      <section id="body" className="block prose">
        <p className="series-lead" data-testid="series-intro">
          {intro}
        </p>
        {editing ? (
          <WikiEditor target={`series:${skey}`} paras={page?.content ?? series.body} baseId={baseId} locked={pageLocked} closeHref={self} label="介紹" />
        ) : series.body.length ? (
          series.body.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p className="fill-row" data-testid="body-missing">
            <span className="fill-label">介紹待補</span>
            <FillLink href={`${self}?edit=1#body`} testid="body-fill" />
          </p>
        )}
        <p className="edit-line" data-testid="last-edit">
          最後修改：{lastBy.by}，{lastBy.date}
          <span className="dot" aria-hidden="true">·</span>
          <Link className="link" href={`${self}/history`}>
            歷史
          </Link>
        </p>
      </section>

      <VersionTable versions={facts.versions} />
      <MarketBox market={market} />

      {main ? (
        <section className="block tracks-main" id="tracks" data-testid="main-tracks">
          <h2 className="block-title">
            曲目<span className="count">{trackCount(main.lines)}</span>
          </h2>
          <p className="sub tracks-basis" data-testid="main-tracks-basis">
            依{main.it.kind}「{main.v.edition}」{main.regular ? "" : "（最早的實體版本）"}
          </p>
          <TrackList lines={main.lines} />
        </section>
      ) : null}

      {series.items.map((it) => {
        const inItem = related.filter((s) => s.link?.item === it.id);
        const loose = inItem.filter((s) => !s.link?.version);
        return (
          <section key={it.id} id={itemAnchor(it)} className="block item-block">
            <h2 className="item-title">{it.kind}</h2>
            <LockBanner target={itemTarget(itemKey(series, it))} locked={isTargetLocked(c.lockData, itemTarget(itemKey(series, it)))} />
            {it.versions.length === 0 ? (
              <p className="sub" data-testid="item-no-version">
                還沒有人補上版本資料
              </p>
            ) : null}
            {it.versions.map((v, vi) => (
              <VersionBlock
                key={v.id}
                series={series}
                item={it}
                v={v}
                related={inItem}
                view={c.toShareView}
                locks={c.lockData}
                price={prices.get(versionKey(series, it, v))}
                tracks={tracks.get(versionAnchor(it, v))}
                editor={tt && tm && tm[1] === it.id && tm[2] === v.id ? { baseId: tracksBase, locked: tracksLocked } : null}
                collections={collections.filter((s) => s.collection?.tags.some((t) => t.key === versionKey(series, it, v))).length}
                base={main ? { v: main.v, lines: main.lines } : null}
                first={vi === 0}
              />
            ))}
            <ItemLooseWall shares={loose.map(c.toShareView)} />
            <ReportBox target={itemTarget(itemKey(series, it))} label={`檢舉這個品項（${it.kind}）`} />
          </section>
        );
      })}

      {collections.length ? (
        <section className="block" id="collections" data-testid="series-collections">
          <h2 className="block-title">
            出現在 <span className="num">{collections.length}</span> 個合集中
          </h2>
          <ShareWall shares={collections.map(c.toShareView)} />
        </section>
      ) : null}

      {contributors.total ? (
        <section className="block contributors" id="contributors" data-testid="contributors">
          <h2 className="block-title">
            資料貢獻者<span className="count">{contributors.total}</span>
          </h2>
          <p className="contrib-list">
            {contributors.list.map((u, i) => (
              <span key={u.handle} className="contrib" data-n={u.n}>
                {i > 0 ? "、" : null}
                <Link className="link contrib-who" href={`/u/${u.handle}`}>
                  <Ava name={u.name} src={u.avatar} />
                  <span>{u.name}</span>
                </Link>
                <LevelTag badge={u.badge} />
              </span>
            ))}
            {contributors.total > contributors.list.length ? <span className="contrib-more">等 {contributors.total} 位</span> : null}
          </p>
        </section>
      ) : null}

      {otherSeries.map((g) => (
        <section key={g.artist.slug} className="block other-series" data-testid="other-series" data-artist={g.artist.slug}>
          <h2 className="block-title">
            {c.artistVisible(g.artist) ? (
              <Link className="link" href={artistHref(g.artist.slug)}>
                {g.artist.name}
              </Link>
            ) : (
              g.artist.name
            )}
            的其他系列
          </h2>
          <ul className="tiles">
            {g.list.map((w) => (
              <SeriesTile key={seriesKey(w)} series={w} credits={c.creditNames(w)} except={g.artist.slug} photo={c.seriesCover(w)} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
