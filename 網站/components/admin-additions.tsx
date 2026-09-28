"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { AdminAddition } from "@/lib/server/additions";

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
          <b>{r.type === "artist" ? "藝人" : "系列"}</b>{" "}
          {r.gone || !r.href ? (
            <span>{r.name}（已不在）</span>
          ) : (
            <Link className="link" href={r.href} target="_blank" data-testid="add-name">
              {r.name}
            </Link>
          )}
          {r.type === "series" ? <span className="sub-inline">　{r.year || "年份不記得"}・{r.artist?.name}</span> : null}
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
        {mode === "rename" ? (
          <div className="add-form">
            <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} aria-label="名稱" data-testid="add-rename-name" />
            {r.type === "series" ? (
              <input className="input input-sm add-year" value={year} onChange={(e) => setYear(e.target.value)} aria-label="年份" placeholder="年份" inputMode="numeric" maxLength={4} />
            ) : null}
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => run({ action: "rename", type: r.type, ref: r.ref, name, year })} data-testid="add-rename-save">
              存
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
              placeholder={r.type === "artist" ? "既有藝人識別碼，例：gordon" : "既有系列，例：gordon/3"}
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
              <button type="button" className="btn btn-line" disabled={busy || r.gone} onClick={() => run({ action: "confirm" })} data-testid="add-confirm">
                沒問題
              </button>
            )}
            {!r.gone ? (
              <>
                <button type="button" className="btn-text" onClick={() => setMode("rename")} data-testid="add-rename">
                  修名
                </button>
                <button type="button" className="btn-text" onClick={() => setMode("merge")} data-testid="add-merge">
                  合併到既有的
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
      {section("待確認", list.filter((r) => !r.confirmedAt), "沒有待確認的新增", "add-open")}
      {section("已確認", list.filter((r) => r.confirmedAt), "沒有紀錄", "add-done")}
    </div>
  );
}
