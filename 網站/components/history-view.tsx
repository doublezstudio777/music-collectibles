import Link from "next/link";
import { charCount, diffParas, type ParaDiff } from "@/lib/diff";
import { PageLockButton, RevertButton } from "@/components/wiki-editor";
import type { RevisionView } from "@/lib/server/wiki";

/** 台灣時間（資料庫存 UTC） */
const day = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

function Diff({ list }: { list: ParaDiff[] }) {
  if (list.every((d) => d.t === "same")) return <p className="empty">兩版內容相同</p>;
  return (
    <div className="diff" data-testid="diff">
      {list.map((d, i) =>
        d.t === "same" ? (
          <p key={i} className="diff-same">
            {d.s}
          </p>
        ) : d.t === "add" ? (
          <p key={i} className="diff-add">
            <ins>{d.s}</ins>
          </p>
        ) : d.t === "del" ? (
          <p key={i} className="diff-del">
            <del>{d.s}</del>
          </p>
        ) : (
          <p key={i} className="diff-change">
            {d.pieces.map((p, j) => (p.t === "same" ? <span key={j}>{p.s}</span> : p.t === "add" ? <ins key={j}>{p.s}</ins> : <del key={j}>{p.s}</del>))}
          </p>
        ),
      )}
    </div>
  );
}

/**
 * 編輯歷史頁（藝人簡介、系列正文共用）：版本清單、兩版比對、還原、管理員鎖定。
 * ?a=舊版 id&b=新版 id；沒給就比最新與前一版。
 */
export function HistoryView({
  title,
  backHref,
  target,
  revisions,
  locked,
  wikiUrl,
  a,
  b,
}: {
  title: string;
  backHref: string;
  target: string;
  revisions: RevisionView[];
  locked: boolean;
  wikiUrl: string | null;
  a?: string;
  b?: string;
}) {
  const byId = (id?: string) => revisions.find((r) => String(r.id) === id);
  const newer = byId(b) ?? revisions[0];
  const older = byId(a) ?? revisions[revisions.indexOf(newer) + 1];
  const licensed = revisions.some((r) => r.license);
  return (
    <main className="wrap page">
      <header className="page-head head-split">
        <div>
          <h1 className="page-title">{title}的編輯歷史</h1>
          <p className="page-meta">
            <Link className="link" href={backHref}>
              回到頁面
            </Link>
            <span className="dot" aria-hidden="true">·</span>
            <span className="num">{revisions.length}</span> 個版本
            {locked ? (
              <>
                <span className="dot" aria-hidden="true">·</span>
                <span className="flag flag-lock" data-testid="locked-flag">
                  已鎖定
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="head-actions">
          <PageLockButton target={target} locked={locked} />
        </div>
      </header>

      {licensed ? (
        <p className="edit-line license-note" data-testid="history-license">
          簡介最初取自
          {wikiUrl ? (
            <a className="link" href={wikiUrl} rel="noopener" target="_blank">
              維基百科
            </a>
          ) : (
            "維基百科"
          )}
          ，之後的改寫版本一樣以{" "}
          <a className="link" href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hant" rel="license noopener" target="_blank">
            CC BY-SA 4.0
          </a>{" "}
          授權
        </p>
      ) : null}

      {revisions.length > 1 ? (
        <section className="block">
          <h2 className="block-title">比較</h2>
          <form className="compare-form" method="get">
            <label className="sr-only" htmlFor="cmp-a">
              舊版
            </label>
            <select id="cmp-a" name="a" className="select" defaultValue={older ? String(older.id) : undefined}>
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  第 {r.no} 版
                </option>
              ))}
            </select>
            <span aria-hidden="true">→</span>
            <label className="sr-only" htmlFor="cmp-b">
              新版
            </label>
            <select id="cmp-b" name="b" className="select" defaultValue={String(newer.id)}>
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  第 {r.no} 版
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-line">
              比較
            </button>
          </form>
          {older ? (
            <>
              <p className="sub diff-head">
                第 {older.no} 版 → 第 {newer.no} 版
              </p>
              <Diff list={diffParas(older.content, newer.content)} />
            </>
          ) : null}
        </section>
      ) : null}

      <section className="block">
        <h2 className="block-title">版本</h2>
        <ul className="rows rev-list" data-testid="rev-list">
          {revisions.map((r, i) => {
            const prev = revisions[i + 1];
            const delta = prev ? charCount(r.content) - charCount(prev.content) : null;
            return (
              <li key={r.id} data-rev={r.id}>
                <span className="row-main">
                  <b>第 {r.no} 版</b>
                  <span className="rev-summary">{r.summary}</span>
                </span>
                <span className="sub">
                  {r.author ? r.author.name : "音藏"} · {day(r.at)}
                  {delta !== null ? <span className="num"> · {delta >= 0 ? `+${delta}` : `−${-delta}`} 字</span> : null}
                  {r.license ? " · CC BY-SA 4.0" : null}
                </span>
                <span className="rev-acts">
                  {prev ? (
                    <Link className="btn-text" href={`?a=${prev.id}&b=${r.id}`}>
                      與上一版比較
                    </Link>
                  ) : null}
                  {i > 0 && r.id > 0 ? <RevertButton id={r.id} no={r.no} /> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
