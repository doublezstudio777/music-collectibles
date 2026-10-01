"use client";

import Link from "@/components/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { AdminAddition } from "@/lib/server/additions";
import type { ScanItem, ScanState } from "@/lib/server/release-scan";

const CONF: Record<string, string> = { high: "高信心，已預填", low: "低信心，只列候選", none: "未查到", dup: "跟既有資料重複" };

/** 自動補資料（2026-09-30）：信心等級、預填了什麼、來源、候選；可駁回預填或重查（可指定 MBID／條碼） */
function Autofill({ r, run, busy }: { r: AdminAddition; run: (body: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [hint, setHint] = useState("");
  const [open, setOpen] = useState(false);
  const af = r.autofill;
  if (!af) return <p className="sub af-none">自動補資料：功能上線前新增的，沒有查</p>;
  const queued = af.status === "queued";
  const label = queued ? "查詢中" : af.status === "error" ? "查詢失敗" : (CONF[af.confidence ?? ""] ?? "—");
  const res = af.result;
  const prefilled = af.confidence === "high" && res.fields.length > 0 && af.decision !== "rejected";
  return (
    <div className="af" data-testid="af" data-status={af.status} data-confidence={af.confidence ?? ""} data-decision={af.decision ?? ""}>
      <p className="af-head">
        <span className={`af-badge af-${queued ? "queued" : (af.confidence ?? "none")}`} data-testid="af-badge">
          {label}
        </span>
        {af.decision === "rejected" ? <span className="sub-inline">　已駁回預填</span> : af.decision === "approved" ? <span className="sub-inline">　已核准</span> : null}
        {!queued && res.summary ? <span className="af-summary">{res.summary}</span> : null}
      </p>
      {res.fields.length && af.decision !== "rejected" ? (
        <dl className="af-fields" data-testid="af-fields">
          {res.fields.map((f, i) => (
            <div key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {res.dup ? (
        <p className="af-dup" data-testid="af-dup" data-into={res.dup.into}>
          建議改掛到：
          {res.dup.url ? (
            <a className="link" href={res.dup.url} target="_blank" rel="noreferrer">
              {res.dup.label}
            </a>
          ) : (
            res.dup.label
          )}
          （{res.dup.into}）
        </p>
      ) : null}
      {res.sources.length ? (
        <p className="af-src" data-testid="af-sources">
          來源：
          {res.sources.map((x, i) => (
            <a key={i} className="link" href={x.url} target="_blank" rel="noreferrer">
              {x.label}
            </a>
          ))}
        </p>
      ) : null}
      {res.candidates.length ? (
        <ul className="af-cands" data-testid="af-cands">
          {res.candidates.slice(0, 8).map((c, i) => (
            <li key={i}>
              <a className="link" href={c.url} target="_blank" rel="noreferrer">
                {c.label}
              </a>
              {c.note ? <span className="sub-inline">　{c.note}</span> : null}
              {c.mbid && af.confidence !== "high" ? (
                <button type="button" className="btn-text" disabled={busy} onClick={() => run({ action: "recheck", hint: c.mbid })} data-testid="af-use">
                  用這筆
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!queued ? (
        <div className="af-acts">
          {prefilled ? (
            <button type="button" className="btn-text" disabled={busy} onClick={() => run({ action: "reject" })} data-testid="af-reject">
              駁回預填
            </button>
          ) : null}
          {open ? (
            <span className="add-form af-recheck">
              <input className="input input-sm" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="MusicBrainz 代碼或條碼（可空白）" aria-label="指定 MusicBrainz 代碼或條碼" data-testid="af-hint" />
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => run({ action: "recheck", hint })} data-testid="af-recheck-go">
                重查
              </button>
              <button type="button" className="btn-text" onClick={() => setOpen(false)}>
                取消
              </button>
            </span>
          ) : (
            <button type="button" className="btn-text" onClick={() => setOpen(true)} data-testid="af-recheck">
              重查
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

function Row({ r, done }: { r: AdminAddition; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"" | "rename" | "merge">("");
  const [name, setName] = useState(r.name);
  const [year, setYear] = useState(r.year);
  const [into, setInto] = useState("");
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    const x = await api("/api/admin/additions", { body: { id: r.id, ...body } });
    setBusy(false);
    if (!x.ok) return setError(x.error.message);
    setMode("");
    done();
  };
  return (
    <li className="er-item" data-testid="add-item" data-id={r.id} data-type={r.type} data-ref={r.ref} data-confirmed={r.confirmedAt ? "1" : "0"}>
      <div className="er-meta">
        <div>
          <b>{r.type === "artist" ? "藝人" : r.type === "version" ? "版本" : "系列"}</b>{" "}
          {r.gone || !r.href ? (
            <span>{r.name}（已不在）</span>
          ) : (
            <Link className="link" href={r.href} target="_blank" prefetch={false} data-testid="add-name">
              {r.name}
            </Link>
          )}
          {r.type === "series" ? <span className="sub-inline">　{r.year || "年份不記得"}・{r.artist?.name}</span> : null}
          {r.type === "version" ? <span className="sub-inline">　{r.year || "年份不記得"}・{r.artist?.name}・{r.series}</span> : null}
          <span className="sub-inline">　識別碼 {r.ref}・{r.used} 則收藏在用</span>
        </div>
        <span className="sub">
          {r.by}・{time(r.createdAt)}
          {r.confirmedAt ? `・已確認（${r.confirmedBy ?? ""}）` : ""}
        </span>
        {r.edits.length ? (
          <ul className="sub add-edits" data-testid="add-edits">
            {r.edits.map((e, i) => (
              <li key={i}>
                {time(e.at)} {e.by}：{e.from} → {e.to}
              </li>
            ))}
          </ul>
        ) : null}
        <Autofill r={r} run={run} busy={busy} />
        {mode === "rename" ? (
          <div className="add-form">
            <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} aria-label="名稱" data-testid="add-rename-name" />
            {r.type !== "artist" ? (
              <input className="input input-sm add-year" value={year} onChange={(e) => setYear(e.target.value)} aria-label="年份" placeholder="年份" inputMode="numeric" maxLength={4} />
            ) : null}
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => run({ action: "rename", type: r.type, ref: r.ref, name, year })} data-testid="add-rename-save">
              儲存
            </button>
            <button type="button" className="btn-text" onClick={() => setMode("")}>
              取消
            </button>
          </div>
        ) : mode === "merge" ? (
          <div className="add-form">
            <input
              className="input input-sm"
              value={into}
              onChange={(e) => setInto(e.target.value)}
              aria-label="併進哪一筆"
              placeholder={r.type === "artist" ? "既有藝人識別碼，例：gordon" : r.type === "version" ? `同品項的版本，例：${r.ref.replace(/-v\d+$/, "-v1")}` : "既有系列，例：gordon/3"}
              data-testid="add-merge-into"
            />
            <button type="button" className="btn btn-line" disabled={busy || !into.trim()} onClick={() => run({ action: "merge", into })} data-testid="add-merge-save">
              合併
            </button>
            <button type="button" className="btn-text" onClick={() => setMode("")}>
              取消
            </button>
          </div>
        ) : (
          <div className="ap-actions">
            {r.confirmedAt ? (
              <button type="button" className="btn-text" disabled={busy} onClick={() => run({ action: "unconfirm" })}>
                改回待確認
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-line"
                disabled={busy || r.gone || r.autofill?.status === "queued"}
                onClick={() => run({ action: r.autofill ? "approve" : "confirm" })}
                data-testid="add-confirm"
              >
                {r.autofill?.confidence === "dup" && r.autofill.result.dup && !r.autofill.decision ? "核准（改掛過去）" : "核准"}
              </button>
            )}
            {!r.gone ? (
              <>
                <button type="button" className="btn-text" onClick={() => setMode("rename")} data-testid="add-rename">
                  修改名稱
                </button>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    if (!into && r.autofill?.result.dup) setInto(r.autofill.result.dup.into);
                    setMode("merge");
                  }}
                  data-testid="add-merge"
                >
                  改掛到既有的
                </button>
              </>
            ) : null}
          </div>
        )}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    </li>
  );
}

function ScanList({ title, rows, testid }: { title: string; rows: ScanItem[]; testid: string }) {
  if (!rows.length) return null;
  return (
    <details className="rs-list" data-testid={testid}>
      <summary>
        {title} <span className="num">{rows.length}</span>
      </summary>
      <ul>
        {rows.map((x, i) => (
          <li key={i}>
            {x.artist}《
            <a className="link" href={x.url} target="_blank" rel="noreferrer">
              {x.title}
            </a>
            》<span className="sub-inline num">　{x.date}</span>
            {x.key ? (
              <>
                {"　"}
                <a className="link" href={`/artist/${x.key}`} target="_blank" rel="noreferrer">
                  {x.key}
                </a>
              </>
            ) : null}
            {x.note ? <span className="sub-inline">　{x.note}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * 每月補新作品（2026-10-01）：每月初排程自動開一輪，這裡看進度、建了哪些、疑義清單；也可以手動開一輪。
 * 建出來的系列跟會員新增的一樣列在下面「待確認」（新增者寫「每月自動補新作品」）
 */
function ReleaseScan({ reload }: { reload: () => void }) {
  const [st, setSt] = useState<ScanState | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // tick 變了就重讀一次；查詢中每 8 秒加一（連同下面的待確認清單一起重讀）
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void api<{ state: ScanState | null }>("/api/admin/release-scan").then((r) => {
      if (live && r.ok) setSt(r.data.state);
    });
    return () => {
      live = false;
    };
  }, [tick]);
  const running = Boolean(st && !st.finishedAt);
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => {
      setTick((n) => n + 1);
      reload();
    }, 8000);
    return () => clearTimeout(t);
  }, [running, st, reload]);
  const act = async (action: "start" | "run") => {
    setBusy(true);
    setError("");
    const r = await api<{ state: ScanState | null }>("/api/admin/release-scan", { method: "POST", body: { action } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setSt(r.data.state);
  };
  if (st === undefined) return null;
  const x = st?.stats;
  return (
    <section className="block rs" data-testid="release-scan" data-running={running ? "1" : "0"}>
      <h2 className="block-title">每月補新作品</h2>
      {st && x ? (
        <>
          <p className="sub" data-testid="rs-progress">
            {st.month}（{st.trigger === "manual" ? "手動" : "排程"}，{time(st.startedAt)} 開始{st.finishedAt ? `，${time(st.finishedAt)} 查完` : "，查詢中"}）：藝人{" "}
            <span className="num">
              {x.artists}／{st.total}
            </span>
            ，發行日 {st.cutoff} 之後
          </p>
          <p className="rs-stats" data-testid="rs-stats">
            新發行 <span className="num">{x.candidates}</span>・建系列 <span className="num">{x.created}</span>・疑義 <span className="num">{x.doubt}</span>・只有數位{" "}
            <span className="num">{x.digital}</span>
          </p>
          <ScanList title="建了這些系列（版本由自動補資料建，列在下方待確認）" rows={st.created} testid="rs-created" />
          <ScanList title="疑義：站上可能已經有（沒建）" rows={st.doubt} testid="rs-doubt" />
          <ScanList title="只有數位或還沒有發行（沒建，一年內每月再看一次）" rows={st.digital} testid="rs-digital" />
          {st.errors.length ? <p className="field-error">{st.errors.join("；")}</p> : null}
        </>
      ) : (
        <p className="sub">還沒跑過，每月第一天台灣時間 02:00 自動開始</p>
      )}
      <div className="ap-actions">
        <button type="button" className="btn btn-line" disabled={busy || running} onClick={() => void act("start")} data-testid="rs-start">
          現在跑一輪
        </button>
        {running ? (
          <button type="button" className="btn-text" disabled={busy} onClick={() => void act("run")} data-testid="rs-run">
            接著查一批
          </button>
        ) : null}
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}

/** 後台「待確認的新增」：會員在炫收藏表單就地新增的藝人、系列，新增當下已生效，這裡事後確認、修名或合併 */
export function AdminAdditions() {
  const [list, setList] = useState<AdminAddition[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ list: AdminAddition[] }>("/api/admin/additions");
    if (r.ok) setList(r.data.list);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // 有工作還在查：每 4 秒重讀，最多 2 分鐘
  const [polls, setPolls] = useState(0);
  const waiting = Boolean(list?.some((r) => r.autofill?.status === "queued"));
  useEffect(() => {
    if (!waiting) setPolls(0);
  }, [waiting]);
  useEffect(() => {
    if (!waiting || polls >= 30) return;
    const t = setTimeout(() => {
      setPolls((n) => n + 1);
      void load();
    }, 4000);
    return () => clearTimeout(t);
  }, [waiting, polls, load]);
  if (error) return <p className="empty">{error}</p>;
  if (!list) return <p className="empty">讀取中</p>;
  const section = (title: string, rows: AdminAddition[], empty: string, testid: string) => (
    <section className="block" data-testid={testid}>
      <h2 className="block-title">
        {title}
        <span className="count">{rows.length}</span>
      </h2>
      {rows.length ? (
        <ul className="ap-list">
          {rows.map((r) => (
            <Row key={r.id} r={r} done={() => void load()} />
          ))}
        </ul>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </section>
  );
  return (
    <div data-testid="additions-admin">
      <ReleaseScan reload={() => void load()} />
      {section("待確認", list.filter((r) => !r.confirmedAt), "沒有待確認的新增", "add-open")}
      {section("已確認", list.filter((r) => r.confirmedAt), "沒有紀錄", "add-done")}
    </div>
  );
}
