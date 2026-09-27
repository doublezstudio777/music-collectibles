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
import { isLocked, lastEdit, latestRevisionId, loadPage } from "@/lib/server/wiki";
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
import { FILL_FIELDS, isBlank, type FillField } from "@/lib/fill";

type Props = { params: Promise<{ artist: string; no: string }>; searchParams?: Promise<{ edit?: string }> };

// 辨識特徵、目錄號、條碼屬於辨識細節（2026-09-28 防盜版批次）：登入會員才看得到，
// 不放進公開頁面（整頁快取訪客與會員同一份），改由 IdentifyDetails 從 /api/details 取
const ROWS: { label: string; get: (v: Version) => string; mono?: boolean }[] = [
  { label: "發行年", get: (v) => v.year, mono: true },
  { label: "地區", get: (v) => v.region },
  { label: "發行", get: (v) => v.label },
  { label: "包裝", get: (v) => v.packaging },
  { label: "內容物", get: (v) => v.contents },
  { label: "曲目", get: (v) => v.tracks },
  { label: "資料狀態", get: (v) => v.status },
];

/** 公開頁面上可以補的空白欄位（目錄號、辨識特徵在登入後的辨識細節補） */
const PUBLIC_FILL = (Object.keys(FILL_FIELDS) as FillField[]).filter(
  (k): k is "year" | "region" | "label" | "packaging" | "contents" | "tracks" => FILL_FIELDS[k].public,
);

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

function Compare({ series, item }: { series: Series; item: Item }) {
  return (
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
        </tbody>
      </table>
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

function PhotoBlock({ caption }: { caption: string }) {
  return (
    <span className="ph-block" role="img" aria-label={`${caption}（示意）`}>
      <b>{caption}</b>
    </span>
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
}: {
  series: Series;
  item: Item;
  v: Version;
  related: Share[];
  view: (s: Share) => ShareView;
  locks: LockData;
  price?: PriceSummary;
}) {
  const list = related.filter((s) => s.link?.version === v.id);
  const refs = list.filter((s) => s.refPhoto);
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

      <IdentifyDetails skey={seriesKey(series)} vkey={vkey} anchor={versionAnchor(item, v)} hasFakes={Boolean(v.fakes?.length)} />
      {refs.length ? (
        <div className="refs">
          <span className="refs-label">收藏者的參考照片</span>
          <ul className="refs-list">
            {refs.map((s) => (
              <li key={s.n}>
                <Link href={shareHref(s.n)} className="ref-thumb" aria-label={s.what}>
                  {s.thumb || s.image ? (
                    <span className="ref-img" style={{ backgroundImage: `url(${s.thumb ?? s.image})` }} />
                  ) : (
                    <PhotoBlock caption={s.kind} />
                  )}
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

export default async function SeriesPage({ params, searchParams }: Props) {
  const { c, series } = await load(params);
  if (!series) notFound();
  const editing = (await searchParams)?.edit === "1";
  const wt = { kind: "series" as const, slug: series.artistSlug, no: series.no };
  const skey = `${series.artistSlug}/${series.no}`;
  const lockedShares = new Set(c.sharesOfSeries(series).filter((s) => c.toShareView(s).lock).map((s) => s.n));
  const [page, pageLocked, edited, baseId, prices, contributors] = await Promise.all([
    editing ? loadPage(wt) : null,
    editing ? isLocked(wt) : false,
    lastEdit(wt),
    editing ? latestRevisionId(`series:${skey}`) : 0,
    priceSummaries(skey, lockedShares),
    seriesContributors(series.artistSlug, series.no),
  ]);
  const self = `/artist/${skey}`;
  const lastBy = edited ?? series.lastEdit;

  const credits = c.creditNames(series);
  const related = c.sharesOfSeries(series);
  const versions = series.items.flatMap((i) => i.versions);
  const owners = versions.reduce((n, v) => n + v.owners, 0);
  // 這位藝人的其他系列：共同署名的每位各一區；隱藏、待審的系列本來就不在目錄裡。依發行年（舊到新，沒填年份的放最後）
  const yearOf = (w: Series) => (/^\d{4}$/.test(w.year) ? Number(w.year) : 9999);
  const coverOf = (w: Series) => c.sharesOfSeries(w).find((x) => x.thumb && !c.toShareView(x).lock)?.thumb ?? null;
  const otherSeries = credits
    .map((a) => ({
      artist: a,
      list: c
        .mainSeriesOf(a.slug)
        .filter((w) => seriesKey(w) !== skey)
        .sort((x, y) => yearOf(x) - yearOf(y) || x.artistSlug.localeCompare(y.artistSlug) || x.no - y.no),
    }))
    .filter((g) => g.list.length > 0);
  const wanted = versions.reduce((n, v) => n + v.wanted, 0);

  return (
    <main className="wrap page">
      <header className="work-head">
        <span className="cover cover-lg" aria-hidden="true" />
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
          <p className="page-meta">
            <span className="num">{owners}</span> 人有 · <span className="num">{wanted}</span> 人想要 ·{" "}
            <span className="num">{related.length}</span> 則炫收藏
          </p>
          {/^\d{4}/.test(series.year) ? null : <YearFill skey={skey} />}
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
        ) : (
          series.body.map((p, i) => <p key={i}>{p}</p>)
        )}
        <p className="edit-line" data-testid="last-edit">
          最後修改：{lastBy.by}，{lastBy.date}
          <span className="dot" aria-hidden="true">·</span>
          <Link className="link" href={`${self}/history`}>
            歷史
          </Link>
        </p>
      </section>

      {series.items.map((it) => {
        const inItem = related.filter((s) => s.link?.item === it.id);
        const loose = inItem.filter((s) => !s.link?.version);
        return (
          <section key={it.id} id={itemAnchor(it)} className="block item-block">
            <h2 className="item-title">{it.kind}</h2>
            <LockBanner target={itemTarget(itemKey(series, it))} locked={isTargetLocked(c.lockData, itemTarget(itemKey(series, it)))} />
            {it.versions.length > 1 ? (
              <Compare series={series} item={it} />
            ) : (
              <Spec series={series} item={it} v={it.versions[0]} />
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
              <SeriesTile key={seriesKey(w)} series={w} credits={c.creditNames(w)} except={g.artist.slug} photo={coverOf(w)} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
