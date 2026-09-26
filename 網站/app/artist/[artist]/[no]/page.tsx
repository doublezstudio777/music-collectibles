import Link from "next/link";
import { notFound } from "next/navigation";
import {
  artistHref,
  creditNames,
  getSeries,
  itemAnchor,
  itemKey,
  itemTarget,
  shareHref,
  sharesOfSeries,
  toShareView,
  versionAnchor,
  versionKey,
  versionTarget,
  type Item,
  type Series,
  type Share,
  type Version,
} from "@/lib/data";
import { HoldingButtons } from "@/components/holding-buttons";
import { NextPhase } from "@/components/next-phase";
import { LockBanner, ReportBox } from "@/components/report";
import { ItemLooseWall, ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ artist: string; no: string }> };

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
  return getSeries(artist, Number(no));
}

export async function generateMetadata({ params }: Props) {
  const w = await load(params);
  if (!w) return { title: "找不到系列" };
  return { title: `${w.name}｜${creditNames(w).map((a) => a.name).join("、")}` };
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

function VersionBlock({ series, item, v, related }: { series: Series; item: Item; v: Version; related: Share[] }) {
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
      <LockBanner target={versionTarget(vkey)} />

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
                  {s.image ? <span className="ref-img" style={{ backgroundImage: `url(${s.image})` }} /> : <PhotoBlock caption={s.kind} />}
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
      <ShareWall
        shares={list.map(toShareView)}
        scope={{ version: versionKey(series, item, v) }}
        empty={<p className="empty">還沒有人炫過這個版本</p>}
      />
      <ReportBox target={versionTarget(vkey)} label="檢舉這個版本" />
    </section>
  );
}

export default async function SeriesPage({ params }: Props) {
  const series = await load(params);
  if (!series) notFound();

  const credits = creditNames(series);
  const related = sharesOfSeries(series);
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
                <Link className="link" href={artistHref(a.slug)}>
                  {a.name}
                </Link>
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
          <NextPhase label="編輯" />
          <NextPhase label="歷史" />
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

      <section className="block prose">
        {series.body.map((p) => (
          <p key={p.slice(0, 12)}>{p}</p>
        ))}
        <p className="edit-line">
          最後修改：{series.lastEdit.by}，{series.lastEdit.date}
        </p>
      </section>

      {series.items.map((it) => {
        const inItem = related.filter((s) => s.link?.item === it.id);
        const loose = inItem.filter((s) => !s.link?.version);
        return (
          <section key={it.id} id={itemAnchor(it)} className="block item-block">
            <h2 className="item-title">{it.kind}</h2>
            <LockBanner target={itemTarget(itemKey(series, it))} />
            {it.versions.length > 1 ? (
              <Compare series={series} item={it} />
            ) : (
              <Spec series={series} item={it} v={it.versions[0]} />
            )}
            {it.versions.map((v) => (
              <VersionBlock key={v.id} series={series} item={it} v={v} related={inItem} />
            ))}
            <ItemLooseWall itemScopeKey={itemKey(series, it)} shares={loose.map(toShareView)} />
            <ReportBox target={itemTarget(itemKey(series, it))} label={`檢舉這個品項（${it.kind}）`} />
          </section>
        );
      })}
    </main>
  );
}
