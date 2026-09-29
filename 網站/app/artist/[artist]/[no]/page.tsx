import Link from "next/link";
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
import { pageData, siteOrigin } from "@/lib/server/viewer";
import { ogMeta } from "@/lib/server/og";
import { CopyLink } from "@/components/share-actions";
import { HoldingButtons, OwnersCount } from "@/components/holding-buttons";
import { PriceHistory } from "@/components/price-history";
import { WikiEditor } from "@/components/wiki-editor";
import { priceSummaries } from "@/lib/server/prices";
import { isLocked, lastEdit, latestRevisionId, loadPage, targetKey, type WikiTarget } from "@/lib/server/wiki";
import { seriesTracks, type VersionTracks } from "@/lib/server/tracks";
import { diffText, diffTracks, parseTracks, REGULAR_EDITION, trackCount } from "@/lib/tracks";
import type { PriceSummary } from "@/lib/prices";
import { LockBanner, ReportBox } from "@/components/report";
import { ItemLooseWall, VersionWall } from "@/components/share-wall";
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
// 不放進公開頁面（整頁快取訪客與會員同一份），改由 IdentifyDetails 從 /api/details 取
const ROWS: { label: string; get: (v: Version) => string; mono?: boolean }[] = [
  { label: "發行年", get: (v) => v.year, mono: true },
  { label: "發行日期", get: (v) => (v.releaseDate && v.releaseDate !== v.year ? v.releaseDate : ""), mono: true },
  { label: "地區", get: (v) => v.region },
  { label: "發行", get: (v) => v.label },
  { label: "包裝", get: (v) => v.packaging },
  { label: "內容物", get: (v) => v.contents },
  { label: "曲目", get: (v) => v.tracks },
  { label: "資料狀態", get: (v) => v.status },
];

/** 公開頁面上可以補的空白欄位（目錄號、辨識特徵在登入後的辨識細節補；曲目改在版本的「曲目」區塊逐首補，2026-09-28） */
const PUBLIC_FILL = (Object.keys(FILL_FIELDS) as FillField[]).filter(
  (k): k is "year" | "region" | "label" | "packaging" | "contents" => FILL_FIELDS[k].public && k !== "tracks",
);

type Tracks = Map<string, VersionTracks>;
const linesOf = (tracks: Tracks, item: Item, v: Version) => tracks.get(versionAnchor(item, v))?.lines ?? [];

/**
 * 系列的代表曲目：一般版（版本名稱有「一般版／標準版」）的曲目；判斷不出來就用最早的實體版本（依發行日期、年份）。
 * 只看有曲目的版本
 */
function mainTracks(series: Series, tracks: Tracks) {
  const all = series.items
    .flatMap((it) => it.versions.map((v, i) => ({ it, v, i, lines: linesOf(tracks, it, v) })))
    .filter((x) => x.lines.length);
  const regular = all.find((x) => REGULAR_EDITION.test(x.v.edition));
  if (regular) return { ...regular, regular: true };
  const when = (v: Version) => v.releaseDate || v.year || "9999";
  const first = [...all].sort((a, b) => when(a.v).localeCompare(when(b.v)))[0];
  return first ? { ...first, regular: false } : null;
}

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

/** 單一版本不比較，只列有值的欄位 */
const hasValue = (x: string) => x && x !== "—" && x !== "待查證" && x !== "無條碼";

async function load(params: Props["params"]) {
  const { artist, no } = await params;
  const { c } = await pageData();
  return { c, series: c.getSeries(artist, Number(no)) };
}

export async function generateMetadata({ params }: Props) {
  const { c, series: w } = await load(params);
  if (!w) return { title: "找不到系列" };
  const artists = c.creditNames(w).map((a) => a.name).join("、");
  const n = c.sharesOfSeries(w).length;
  return ogMeta({
    origin: await siteOrigin(),
    path: `/artist/${w.artistSlug}/${w.no}`,
    title: `${w.name}｜${artists}`,
    description: [artists, w.title, Array.from(new Set(w.items.map((i) => i.kind))).join("、"), n ? `${n} 則炫收藏` : ""].filter(Boolean).join("・"),
    photo: c.ogPhotoOf(c.sharesOfSeries(w)),
  });
}

function Compare({ series, item, tracks, base }: { series: Series; item: Item; tracks: Tracks; base: Version | null }) {
  const baseLines = base ? (series.items.flatMap((it) => it.versions.map((v) => ({ v, l: linesOf(tracks, it, v) }))).find((x) => x.v === base)?.l ?? []) : [];
  const trackDiffs = item.versions.map((v) => {
    const l = linesOf(tracks, item, v);
    if (!l.length || !baseLines.length) return { text: "—", same: true };
    if (v === base) return { text: "比較基準", same: true };
    const d = diffTracks(baseLines, l);
    return { text: diffText(d), same: d.same };
  });
  const showDiff = baseLines.length > 0 && item.versions.some((v) => linesOf(tracks, item, v).length);
  return (
    <div className="compare-scroll-wrap">
      {item.versions.length > 2 ? (
        <p className="compare-hint" aria-hidden="true">
          左右滑動看更多版本 →
        </p>
      ) : null}
      <div className="compare-scroll">
      <table className="compare" style={{ "--cols": item.versions.length } as React.CSSProperties}>
        <thead>
          <tr>
            <th className="compare-key" scope="col">
              <span className="sr-only">欄位</span>
            </th>
            {item.versions.map((v) => (
              <th key={v.id} scope="col" className="compare-ver">
                <a className="ver-name" href={`#${versionAnchor(item, v)}`}>
                  {v.edition}
                </a>
                <span className="sub">
                  {v.year} · {v.region}
                </span>
                <HoldingButtons vkey={versionKey(series, item, v)} owners={v.owners} wanted={v.wanted} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.filter((row) => item.versions.some((v) => hasValue(row.get(v)))).map((row) => {
            const values = item.versions.map(row.get);
            const differs = new Set(values).size > 1;
            return (
              <tr key={row.label} className={differs ? "diff" : undefined}>
                <th scope="row" className="compare-key">
                  {row.label}
                </th>
                {values.map((val, i) => (
                  <td key={item.versions[i].id} className={row.mono ? "mono" : undefined}>
                    {val}
                  </td>
                ))}
              </tr>
            );
          })}
          {showDiff ? (
            <tr className={trackDiffs.some((d) => !d.same) ? "diff" : undefined} data-testid="track-diff-row">
              <th scope="row" className="compare-key">
                曲目差異
              </th>
              {trackDiffs.map((d, i) => (
                <td key={item.versions[i].id} data-testid="track-diff">
                  {d.text}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function Spec({ series, item, v }: { series: Series; item: Item; v: Version }) {
  const rows = ROWS.filter((r) => hasValue(r.get(v)));
  return (
    <div className="spec">
      <HoldingButtons vkey={versionKey(series, item, v)} owners={v.owners} wanted={v.wanted} />
      <dl className="spec-list">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className={r.mono ? "mono" : undefined}>{r.get(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
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
}: {
  series: Series;
  item: Item;
  v: Version;
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
  return (
    <section id={versionAnchor(item, v)} className="ver-block">
      <h3 className="ver-title">
        {v.edition}
        {v.fakes?.length ? <span className="flag flag-fake">有已知仿冒</span> : null}
        <OwnersCount vkey={vkey} owners={v.owners} />
      </h3>
      <LockBanner target={versionTarget(vkey)} locked={isTargetLocked(locks, versionTarget(vkey))} />
      <FieldFill vkey={vkey} fields={PUBLIC_FILL.filter((f) => isBlank(f, v[f]))} />

      {price ? <PriceHistory summary={price} /> : null}

      <VersionTracksBlock series={series} anchor={versionAnchor(item, v)} vkey={vkey} t={tracks} editor={editor ?? null} />

      <IdentifyDetails skey={seriesKey(series)} vkey={vkey} anchor={versionAnchor(item, v)} hasFakes={Boolean(v.fakes?.length)} />
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

      <h4 className="sub-title">
        炫收藏<span className="count">{list.length}</span>
      </h4>
      <VersionWall shares={list.map(view)} confirmed={v.status === "已確認"} id={versionAnchor(item, v)} />
      <ReportBox target={versionTarget(vkey)} label="檢舉這個版本" />
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
}: {
  series: Series;
  anchor: string;
  vkey: string;
  t?: VersionTracks;
  editor: { baseId: number; locked: boolean } | null;
}) {
  const lines = t?.lines ?? [];
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
    seriesTracks(series.artistSlug, series.no),
    tt ? isLocked(tt) : false,
    tt ? latestRevisionId(targetKey(tt)) : 0,
  ]);
  const main = mainTracks(series, tracks);
  const self = `/artist/${skey}`;
  const lastBy = edited ?? series.lastEdit;

  const credits = c.creditNames(series);
  const related = c.sharesOfSeries(series);
  const versions = series.items.flatMap((i) => i.versions);
  const owners = versions.reduce((n, v) => n + v.owners, 0);
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
  const wanted = versions.reduce((n, v) => n + v.wanted, 0);

  return (
    <main className="wrap page">
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
            <span className="num">{owners}</span> 人有 · <span className="num">{wanted}</span> 人想要 ·{" "}
            <span className="num">{related.length}</span> 則炫收藏
          </p>
          {/^\d{4}/.test(series.year) || series.kind === "misc" ? null : <YearFill skey={skey} />}
        </div>
        <div className="head-actions">
          <CopyLink />
          <Link className="btn btn-line" href={`${self}?edit=1#body`} data-testid="edit-link">
            編輯
          </Link>
          <Link className="btn btn-line" href={`${self}/history`}>
            歷史
          </Link>
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
        {editing ? (
          <WikiEditor target={`series:${skey}`} paras={page?.content ?? series.body} baseId={baseId} locked={pageLocked} closeHref={self} label="正文" />
        ) : series.body.length ? (
          series.body.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p className="fill-row" data-testid="body-missing">
            <span className="fill-label">正文待補</span>
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
            {it.versions.length > 1 ? (
              <Compare series={series} item={it} tracks={tracks} base={main?.v ?? null} />
            ) : it.versions.length === 1 ? (
              <Spec series={series} item={it} v={it.versions[0]} />
            ) : (
              <p className="sub" data-testid="item-no-version">
                還沒有人補上版本資料
              </p>
            )}
            {it.versions.map((v) => (
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
              />
            ))}
            <ItemLooseWall shares={loose.map(c.toShareView)} />
            <ReportBox target={itemTarget(itemKey(series, it))} label={`檢舉這個品項（${it.kind}）`} />
          </section>
        );
      })}

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
