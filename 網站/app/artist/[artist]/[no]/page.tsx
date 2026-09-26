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
  type Item,
  type LockData,
  type Series,
  type Share,
  type ShareView,
  type Version,
} from "@/lib/data";
import { pageData } from "@/lib/server/viewer";
import { HoldingButtons } from "@/components/holding-buttons";
import { PriceHistory } from "@/components/price-history";
import { WikiEditor } from "@/components/wiki-editor";
import { priceSummaries } from "@/lib/server/prices";
import { isLocked, lastEdit, latestRevisionId, loadPage } from "@/lib/server/wiki";
import type { PriceSummary } from "@/lib/prices";
import { LockBanner, ReportBox } from "@/components/report";
import { ItemLooseWall, ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ artist: string; no: string }>; searchParams?: Promise<{ edit?: string }> };

const ROWS: { label: string; get: (v: Version) => string; mono?: boolean }[] = [
  { label: "辨識特徵", get: (v) => v.identifyBy },
  { label: "發行年", get: (v) => v.year, mono: true },
  { label: "地區", get: (v) => v.region },
  { label: "發行", get: (v) => v.label },
  { label: "目錄號", get: (v) => v.catalog, mono: true },
  { label: "條碼", get: (v) => v.barcode, mono: true },
  { label: "包裝", get: (v) => v.packaging },
  { label: "內容物", get: (v) => v.contents },
  { label: "曲目", get: (v) => v.tracks },
  { label: "資料狀態", get: (v) => v.status },
];

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
  return { title: `${w.name}｜${c.creditNames(w).map((a) => a.name).join("、")}` };
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
  const rows = ROWS.filter((r) => r.label !== "辨識特徵" && hasValue(r.get(v)));
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
  const marks = [
    ...(hasValue(v.barcode) ? [{ label: "條碼", text: v.barcode, photo: undefined }] : []),
    ...(hasValue(v.catalog) ? [{ label: "目錄號", text: v.catalog, photo: undefined }] : []),
    ...(v.marks ?? []),
  ];
  const vkey = versionKey(series, item, v);
  return (
    <section id={versionAnchor(item, v)} className="ver-block">
      <h3 className="ver-title">
        {v.edition} {hasValue(v.catalog) ? <span className="mono sub-inline">{v.catalog}</span> : null}
        {v.fakes?.length ? <span className="flag flag-fake">有已知仿冒</span> : null}
      </h3>
      <LockBanner target={versionTarget(vkey)} locked={isTargetLocked(locks, versionTarget(vkey))} />

      {price ? <PriceHistory summary={price} /> : null}

      <h4 className="sub-title">正版辨識</h4>
      <ul className="marks">
        {marks.map((m) => (
          <li key={m.label + m.text} className={m.photo ? "mark has-photo" : "mark"}>
            {m.photo ? <PhotoBlock caption={m.photo} /> : null}
            <span className="mark-text">
              <b>{m.label}</b>
              <span className={m.label === "條碼" || m.label === "目錄號" ? "mono" : undefined}>{m.text}</span>
            </span>
          </li>
        ))}
      </ul>
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

      {v.fakes?.length ? (
        <>
          <h4 className="sub-title" id={`${versionAnchor(item, v)}-fakes`}>
            已知仿冒
          </h4>
          {v.fakes.map((f) => (
            <div key={f.name} className="fake">
              <p className="fake-head">
                <b>{f.name}</b>
                <span className="sub">{f.seen}</span>
              </p>
              <div className="fake-photos">
                <figure>
                  <PhotoBlock caption="正版" />
                  <figcaption>正版</figcaption>
                </figure>
                <figure>
                  <PhotoBlock caption="仿冒" />
                  <figcaption>仿冒</figcaption>
                </figure>
              </div>
              <table className="tbl fake-tbl">
                <thead>
                  <tr>
                    <th>特徵</th>
                    <th>正版</th>
                    <th>仿冒</th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>{r.genuine}</td>
                      <td>{r.fake}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      ) : null}

      <h4 className="sub-title">
        炫收藏<span className="count">{list.length}</span>
      </h4>
      <ShareWall shares={list.map(view)} empty={<p className="empty">還沒有人炫過這個版本</p>} />
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
  const [page, pageLocked, edited, baseId, prices] = await Promise.all([
    editing ? loadPage(wt) : null,
    editing ? isLocked(wt) : false,
    lastEdit(wt),
    editing ? latestRevisionId(`series:${skey}`) : 0,
    priceSummaries(skey, lockedShares),
  ]);
  const self = `/artist/${skey}`;
  const lastBy = edited ?? series.lastEdit;

  const credits = c.creditNames(series);
  const related = c.sharesOfSeries(series);
  const versions = series.items.flatMap((i) => i.versions);
  const owners = versions.reduce((n, v) => n + v.owners, 0);
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
        </div>
        <div className="head-actions">
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
    </main>
  );
}
