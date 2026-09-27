"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { MemberRow } from "@/lib/server/members";

type Res = { members: MemberRow[]; total: number; page: number; pageSize: number };
const day = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);
const STATUS = { active: "正常", suspended: "停權" } as Record<string, string>;

function Actions({ m, done }: { m: MemberRow; done: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (m.admin) return <span className="sub">管理員</span>;
  const run = async (action: "suspend" | "restore") => {
    setError("");
    const r = await api(`/api/admin/members`, { body: { id: m.id, action, reason } });
    if (!r.ok) return setError(r.error.message);
    setOpen(false);
    setReason("");
    done();
  };
  if (m.status === "suspended") {
    return (
      <button type="button" className="btn btn-line" onClick={() => void run("restore")} data-testid="restore">
        恢復
      </button>
    );
  }
  return open ? (
    <div className="suspend-form">
      <input className="input" value={reason} placeholder="停權原因" aria-label="停權原因" onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="btn btn-line" onClick={() => void run("suspend")} data-testid="suspend-confirm">
        確定停權
      </button>
      <button type="button" className="btn btn-text" onClick={() => setOpen(false)}>
        取消
      </button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  ) : (
    <button type="button" className="btn btn-line" onClick={() => setOpen(true)} data-testid="suspend">
      停權
    </button>
  );
}

export function AdminMembers() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [d, setD] = useState<Res | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const p = new URLSearchParams({ q, status, page: String(page) });
    const r = await api<Res>(`/api/admin/members?${p}`);
    if (r.ok) setD(r.data);
    else setError(r.error.message);
  }, [q, status, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <p className="empty">{error}</p>;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <section className="block" data-testid="members">
      <div className="member-filter">
        <label className="sr-only" htmlFor="member-q">
          搜尋會員
        </label>
        <input
          id="member-q"
          className="input"
          value={q}
          placeholder="暱稱、Email、帳號"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <label className="sr-only" htmlFor="member-status">
          狀態
        </label>
        <select
          id="member-status"
          className="select"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部狀態</option>
          <option value="active">正常</option>
          <option value="suspended">停權</option>
        </select>
        <span className="sub num">{d ? `${d.total} 位` : ""}</span>
      </div>
      <p className="sub">私訊內容不在後台顯示，只列對話數。</p>
      <div className="tbl-scroll">
        <table className="tbl members-tbl" data-testid="members-table">
          <thead>
            <tr>
              <th>暱稱</th>
              <th>Email</th>
              <th>註冊日</th>
              <th>所在地區</th>
              <th>驗證</th>
              <th className="num">發文</th>
              <th className="num">成交</th>
              <th className="num">被檢舉</th>
              <th className="num">對話</th>
              <th>狀態</th>
              <th>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d?.members.map((m) => (
              <tr key={m.id} data-handle={m.handle} data-status={m.status}>
                <td>
                  {m.status === "active" ? (
                    <Link className="link" href={`/u/${m.handle}`}>
                      {m.name}
                    </Link>
                  ) : (
                    m.name
                  )}
                  <span className="sub">@{m.handle}</span>
                </td>
                <td className="mono">{m.email}</td>
                <td className="num">{day(m.createdAt)}</td>
                <td>{m.region}</td>
                <td>{m.verified ? "已驗證" : "未驗證"}</td>
                <td className="num">{m.posts}</td>
                <td className="num">{m.deals}</td>
                <td className="num">{m.reported}</td>
                <td className="num">{m.threads}</td>
                <td>
                  {STATUS[m.status] ?? m.status}
                  {m.deletionRequested ? <span className="sub">申請刪除</span> : null}
                </td>
                <td>
                  <Actions m={m} done={() => void load()} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav className="pager" aria-label="分頁">
          <button type="button" className="btn btn-line" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一頁
          </button>
          <span className="num">
            {page} / {pages}
          </span>
          <button type="button" className="btn btn-line" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            下一頁
          </button>
        </nav>
      ) : null}
    </section>
  );
}
