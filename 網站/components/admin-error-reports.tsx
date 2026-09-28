"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { ERROR_REASON_LABEL } from "@/lib/data";
import type { AdminErrorReport } from "@/lib/server/moderation";

const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const STATUS: Record<AdminErrorReport["status"], string> = { open: "待處理", fixed: "已修正", ignored: "不處理" };

function Row({ r, done }: { r: AdminErrorReport; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: "fixed" | "ignored" | "reopen") => {
    setBusy(true);
    setError("");
    const x = await api("/api/admin/error-reports", { body: { id: r.id, action } });
    setBusy(false);
    if (!x.ok) return setError(x.error.message);
    done();
  };
  return (
    <li className="er-item" data-testid="er-item" data-id={r.id} data-status={r.status} data-share={r.share.no}>
      {r.photo ? (
        <a href={r.photo.url} target="_blank" rel="noopener" className="er-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.photo.thumb} alt="比對照片" loading="lazy" />
        </a>
      ) : null}
      <div className="er-meta">
        <div>
          <b>{ERROR_REASON_LABEL[r.reason] ?? r.reason}</b>
          <span className="sub-inline">
            {" "}
            ・
            {r.share.gone ? (
              `${r.share.what}（已下架或刪除）`
            ) : (
              <Link className="link" href={`/share/${r.share.no}`} target="_blank">
                {r.share.what}
              </Link>
            )}
          </span>
        </div>
        {r.note ? <p className="er-note">{r.note}</p> : null}
        <span className="sub">
          {r.by ? `@${r.by.handle}（${r.by.name}）` : "（已刪除的會員）"}・{time(r.createdAt)}
          {r.status !== "open" ? `・${STATUS[r.status]}${r.handledBy ? `（${r.handledBy}）` : ""}${r.handledAt ? ` ${time(r.handledAt)}` : ""}` : ""}
        </span>
        <div className="ap-actions">
          {r.status === "open" ? (
            <>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => run("fixed")} data-testid="er-fixed">
                已修正
              </button>
              <button type="button" className="btn-text" disabled={busy} onClick={() => run("ignored")} data-testid="er-ignored">
                不處理
              </button>
            </>
          ) : (
            <button type="button" className="btn-text" disabled={busy} onClick={() => run("reopen")} data-testid="er-reopen">
              改回待處理
            </button>
          )}
        </div>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    </li>
  );
}

/** 後台「錯誤回報」：單則頁回報的資料有誤、不是這位藝人、重複發文、其他。不計入檢舉門檻 */
export function AdminErrorReports() {
  const [list, setList] = useState<AdminErrorReport[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ list: AdminErrorReport[] }>("/api/admin/error-reports");
    if (r.ok) setList(r.data.list);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="empty">{error}</p>;
  if (!list) return <p className="empty">讀取中</p>;
  const open = list.filter((r) => r.status === "open");
  const done = list.filter((r) => r.status !== "open");
  const section = (title: string, rows: AdminErrorReport[], empty: string, testid: string) => (
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
    <div data-testid="error-reports-admin">
      <p className="sub">錯誤回報不計入檢舉門檻，不會鎖定交易，也不算分。要改資料請到該則收藏或系列頁編輯。</p>
      {section("待處理", open, "沒有待處理的錯誤回報", "er-open")}
      {section("最近處理", done, "沒有紀錄", "er-done")}
    </div>
  );
}
