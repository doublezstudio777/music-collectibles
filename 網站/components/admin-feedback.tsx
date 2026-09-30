"use client";

import Link from "@/components/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { FEEDBACK_LABEL } from "@/lib/feedback";
import type { AdminFeedback as Row } from "@/lib/server/feedback";

const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

function Item({ r, done }: { r: Row; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState(r.note);
  const [saved, setSaved] = useState(false);
  const run = async (action: "done" | "reopen" | "note") => {
    setBusy(true);
    setError("");
    setSaved(false);
    const x = await api("/api/admin/feedback", { body: { id: r.id, action, note } });
    setBusy(false);
    if (!x.ok) return setError(x.error.message);
    if (action === "note") setSaved(true);
    else done();
  };
  const photo = (size: string) => `/api/admin/feedback/photo?id=${r.id}&size=${size}`;
  return (
    <li className="er-item" data-testid="fb-item" data-id={r.id} data-status={r.status} data-kind={r.kind}>
      {r.photo ? (
        <a href={photo("full")} target="_blank" rel="noopener" className="er-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo("thumb")} alt="附件照片" loading="lazy" />
        </a>
      ) : null}
      <div className="er-meta">
        <div>
          <b>{FEEDBACK_LABEL[r.kind] ?? r.kind}</b>
          <span className="sub-inline">
            {" "}・{r.email}
            {r.by ? (
              <>
                {"・"}
                <Link className="link" href={`/u/${r.by.handle}`} target="_blank">
                  @{r.by.handle}
                </Link>
              </>
            ) : "・未登入"}
          </span>
        </div>
        <p className="er-note fb-body">{r.body}</p>
        <span className="sub">
          {time(r.createdAt)}
          {r.status === "done" ? `・已處理${r.handledBy ? `（${r.handledBy}）` : ""}${r.handledAt ? ` ${time(r.handledAt)}` : ""}` : ""}
        </span>
        <label className="sr-only" htmlFor={`fb-note-${r.id}`}>
          內部備註
        </label>
        <textarea
          id={`fb-note-${r.id}`}
          className="input textarea fb-note"
          rows={2}
          maxLength={2000}
          placeholder="內部備註"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          data-testid="fb-note"
        />
        <div className="ap-actions">
          {r.status === "open" ? (
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => run("done")} data-testid="fb-done">
              已處理
            </button>
          ) : (
            <button type="button" className="btn-text" disabled={busy} onClick={() => run("reopen")} data-testid="fb-reopen">
              改回未處理
            </button>
          )}
          <button type="button" className="btn-text" disabled={busy} onClick={() => run("note")} data-testid="fb-save-note">
            儲存備註
          </button>
          {saved ? (
            <span className="sub" role="status">
              已儲存
            </span>
          ) : null}
        </div>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    </li>
  );
}

/** 後台「意見回饋」：/feedback 送來的，含未登入訪客 */
export function AdminFeedback() {
  const [list, setList] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ list: Row[] }>("/api/admin/feedback");
    if (r.ok) setList(r.data.list);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="empty">{error}</p>;
  if (!list) return <p className="empty">讀取中</p>;
  const section = (title: string, rows: Row[], empty: string, testid: string) => (
    <section className="block" data-testid={testid}>
      <h2 className="block-title">
        {title}
        <span className="count">{rows.length}</span>
      </h2>
      {rows.length ? (
        <ul className="ap-list">
          {rows.map((r) => (
            <Item key={`${r.id}-${r.status}`} r={r} done={() => void load()} />
          ))}
        </ul>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </section>
  );
  return (
    <div data-testid="feedback-admin">
      {section("未處理", list.filter((r) => r.status === "open"), "沒有未處理的意見回饋", "fb-open")}
      {section("最近處理", list.filter((r) => r.status === "done"), "沒有紀錄", "fb-done-list")}
    </div>
  );
}
