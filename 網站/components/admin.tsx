"use client";

import Link from "next/link";
import { useState } from "react";
import {
  describeTarget,
  getUser,
  reasonLabel,
  reportSeeds,
  type ReportReason,
  type TargetKey,
} from "@/lib/data";
import { decideAppeal, setThreshold, targetState, useAppState } from "@/lib/state";

const STATUS_WORD = { pending: "審核中", unlocked: "已解鎖", kept: "維持鎖定" } as const;

/** 管理後台雛形：只用示範資料，不做權限 */
export function Admin() {
  const { state, ready } = useAppState();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!ready) return null;

  // 示範計數＋自己投的
  const targets = new Map<TargetKey, Partial<Record<ReportReason, number>>>();
  reportSeeds.forEach((r) => targets.set(r.target, { ...r.counts }));
  state.reports.forEach((r) => {
    const c = targets.get(r.target) ?? {};
    c[r.reason] = (c[r.reason] ?? 0) + 1;
    targets.set(r.target, c);
  });
  const rows = [...targets.entries()]
    .map(([t, counts]) => ({ t, counts, st: targetState(state, t), d: describeTarget(t) }))
    .sort((a, b) => b.st.count - a.st.count);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(draft ?? state.threshold);
    if (!Number.isInteger(n) || n < 1) {
      setError("填 1 以上的整數");
      return;
    }
    setError("");
    setThreshold(n);
    setDraft(null);
  };

  return (
    <div className="admin">
      <section className="block">
        <h2 className="block-title">檢舉門檻</h2>
        <form className="threshold" onSubmit={save} noValidate>
          <label htmlFor="threshold">幾人檢舉就鎖</label>
          <input
            id="threshold"
            className="input input-num"
            inputMode="numeric"
            value={draft ?? String(state.threshold)}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
          />
          <button type="submit" className="btn btn-line">
            儲存
          </button>
          {error ? <p className="field-error">{error}</p> : null}
        </form>
      </section>

      <section className="block">
        <h2 className="block-title">
          檢舉<span className="count">{rows.length}</span>
        </h2>
        <div className="tbl-scroll">
          <table className="tbl admin-tbl" data-testid="report-table">
            <thead>
              <tr>
                <th>對象</th>
                <th>層級</th>
                <th>理由</th>
                <th className="num-col">人數</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, counts, st, d }) => (
                <tr key={t} data-target={t}>
                  <td>
                    <Link className="link" href={d.href}>
                      {d.title}
                    </Link>
                  </td>
                  <td>{d.levelName}</td>
                  <td>
                    {(Object.entries(counts) as [ReportReason, number][])
                      .map(([r, n]) => `${reasonLabel(d.level, r)} ${n}`)
                      .join("、")}
                  </td>
                  <td className="num-col num">{st.count}</td>
                  <td>
                    {st.locked ? (
                      <span className="flag flag-lock">已鎖定</span>
                    ) : st.decision === "unlocked" ? (
                      "已解鎖"
                    ) : (
                      "未達門檻"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2 className="block-title">
          申訴<span className="count">{state.appeals.length}</span>
        </h2>
        {state.appeals.length === 0 ? <p className="empty">沒有申訴</p> : null}
        <ul className="appeals">
          {state.appeals.map((a) => {
            const d = describeTarget(a.target);
            return (
              <li key={a.id} className="appeal" data-status={a.status} data-target={a.target}>
                <div className="appeal-head">
                  <Link className="link" href={d.href}>
                    {d.title}
                  </Link>
                  <span className="sub">
                    {d.levelName} · {getUser(a.by)?.name ?? a.by} · {a.time}
                  </span>
                  <span className={a.status === "pending" ? "appeal-st is-pending" : "appeal-st"}>{STATUS_WORD[a.status]}</span>
                </div>
                <p className="appeal-text">{a.text}</p>
                <div className="evidence">
                  {a.photos.map((p, i) => (
                    <span key={i} className="evidence-ph" style={{ backgroundImage: `url(${p})` }} role="img" aria-label={`證據 ${i + 1}`} />
                  ))}
                  {(a.photoNotes ?? []).map((n) => (
                    <span key={n} className="evidence-ph evidence-note" role="img" aria-label={`${n}（示意）`}>
                      {n}
                    </span>
                  ))}
                </div>
                {a.status === "pending" ? (
                  <div className="report-acts">
                    <button type="button" className="btn btn-line" onClick={() => decideAppeal(a.id, "unlocked")}>
                      解鎖
                    </button>
                    <button type="button" className="btn btn-line" onClick={() => decideAppeal(a.id, "kept")}>
                      維持鎖定
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
