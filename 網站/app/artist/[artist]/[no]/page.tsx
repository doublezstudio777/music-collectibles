import Link from "next/link";
import { notFound } from "next/navigation";
import {
  artistHref,
  creditNames,
  getWork,
  sharesOfWork,
  toShareView,
  versionKey,
  type Version,
} from "@/lib/data";
import { HoldingButtons } from "@/components/holding-buttons";
import { NextPhase } from "@/components/next-phase";
import { ShareWall } from "@/components/share-wall";

type Props = { params: Promise<{ artist: string; no: string }> };

const ROWS: { label: string; get: (v: Version) => string; mono?: boolean }[] = [
  { label: "辨識特徵", get: (v) => v.identifyBy },
  { label: "發行年", get: (v) => v.year, mono: true },
  { label: "地區", get: (v) => v.region },
  { label: "發行公司", get: (v) => v.label },
  { label: "格式", get: (v) => v.format },
  { label: "目錄號", get: (v) => v.catalog, mono: true },
  { label: "條碼", get: (v) => v.barcode, mono: true },
  { label: "包裝", get: (v) => v.packaging },
  { label: "內容物", get: (v) => v.contents },
  { label: "曲目", get: (v) => v.tracks },
  { label: "資料狀態", get: (v) => v.status },
];

async function load(params: Props["params"]) {
  const { artist, no } = await params;
  return getWork(artist, Number(no));
}

export async function generateMetadata({ params }: Props) {
  const w = await load(params);
  if (!w) return { title: "找不到作品" };
  return { title: `${w.title}｜${creditNames(w).map((a) => a.name).join("、")}` };
}

export default async function WorkPage({ params }: Props) {
  const work = await load(params);
  if (!work) notFound();

  const credits = creditNames(work);
  const related = sharesOfWork(work);
  const owners = work.versions.reduce((n, v) => n + v.owners, 0);
  const wanted = work.versions.reduce((n, v) => n + v.wanted, 0);
  const multi = work.versions.length > 1;

  return (
    <main className="wrap page">
      <header className="work-head">
        <span className="cover cover-lg" style={{ background: work.versions[0]?.color }} aria-hidden="true" />
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
          <h1 className="page-title">{work.title}</h1>
          <p className="page-meta">
            {work.year} · {work.workType} · {work.versions.length} 個版本
          </p>
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

      <section className="block">
        <h2 className="block-title">版本</h2>
        <div className="compare-scroll">
          <table className="compare" style={{ "--cols": work.versions.length } as React.CSSProperties}>
            <thead>
              <tr>
                <th className="compare-key" scope="col">
                  <span className="sr-only">欄位</span>
                </th>
                {work.versions.map((v) => (
                  <th key={v.id} scope="col" className="compare-ver">
                    <a className="ver-name" href={`#${v.id}`}>
                      {v.edition}
                    </a>
                    <span className="sub">
                      {v.year} · {v.region} · {v.format}
                    </span>
                    <HoldingButtons vkey={versionKey(work, v)} owners={v.owners} wanted={v.wanted} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const values = work.versions.map(row.get);
                const differs = multi && new Set(values).size > 1;
                return (
                  <tr key={row.label} className={differs ? "diff" : undefined}>
                    <th scope="row" className="compare-key">
                      {row.label}
                    </th>
                    {values.map((val, i) => (
                      <td key={work.versions[i].id} className={row.mono ? "mono" : undefined}>
                        {val}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block prose">
        {work.body.map((p) => (
          <p key={p.slice(0, 12)}>{p}</p>
        ))}
        <p className="edit-line">
          最後修改：{work.lastEdit.by}，{work.lastEdit.date}
        </p>
      </section>

      <section className="block">
        <h2 className="block-title">相關炫收藏</h2>
        {work.versions.map((v) => {
          const list = related.filter((s) => s.link?.version === v.id).map(toShareView);
          return (
            <section key={v.id} id={v.id} className="ver-block">
              <h3 className="ver-title">
                {v.edition} <span className="mono sub-inline">{v.catalog}</span>
                <span className="count">{list.length}</span>
              </h3>
              <ShareWall shares={list} empty={<p className="empty">還沒有人炫過這個版本</p>} />
            </section>
          );
        })}
        {related.some((s) => !s.link?.version) ? (
          <section className="ver-block">
            <h3 className="ver-title">未指定版本</h3>
            <ShareWall shares={related.filter((s) => !s.link?.version).map(toShareView)} />
          </section>
        ) : null}
      </section>
    </main>
  );
}
