"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { LEVELS, levelLabel } from "@/lib/levels";
import type { MemberRow } from "@/lib/server/members";

// 跟 lib/server/members.ts 的 SUSPEND_REASONS 同一份（伺服器檔不能被 client 元件載入）
const REASONS = [
  ["fraud", "詐騙"],
  ["piracy", "販售盜版"],
  ["sockpuppet", "分身刷分"],
  ["spam", "洗版或騷擾"],
  ["other", "其他"],
] as const;

type Res = { members: MemberRow[]; total: number; page: number; pageSize: number };
const day = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);
const STATUS = { active: "正常", suspended: "停權" } as Record<string, string>;

function Actions({ m, done }: { m: MemberRow; done: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (m.admin) return <span className="sub">管理員</span>;
  const run = async (action: "suspend" | "restore") => {
    setError("");
    if (action === "suspend" && !code) return setError("選一個停權原因");
    const r = await api(`/api/admin/members`, { body: { id: m.id, action, reasonCode: code, note: reason } });
    if (!r.ok) return setError(r.error.message);
    setOpen(false);
    setCode("");
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
      <select className="select" value={code} aria-label="停權原因" onChange={(e) => setCode(e.target.value)} data-testid="suspend-code">
        <option value="">停權原因</option>
        {REASONS.map(([k, t]) => (
          <option key={k} value={k}>
            {t}
          </option>
        ))}
      </select>
      <input
        className="input"
        value={reason}
        placeholder={code === "other" ? "說明（必填）" : "說明（選填）"}
        aria-label="停權說明"
        onChange={(e) => setReason(e.target.value)}
        data-testid="suspend-note"
      />
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

/** 等級欄：目前顯示的等級；可以指定（必填原因）或取消指定 */
function LevelCell({ m, done }: { m: MemberRow; done: () => void }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(String(m.override ?? ""));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (m.admin) return <span>館長</span>;
  const run = async (action: "set_level" | "clear_level") => {
    setError("");
    const r = await api(`/api/admin/members`, { body: { id: m.id, action, level: Number(level), reason } });
    if (!r.ok) return setError(r.error.message);
    setOpen(false);
    setReason("");
    done();
  };
  return (
    <div className="level-cell" data-testid="level-cell">
      <span data-testid="level-label">{m.level}</span>
      {m.override ? (
        <span className="sub" title={m.overrideReason} data-testid="level-override">
          指定（計算值 {m.score.toLocaleString("en-US")} 分）
        </span>
      ) : (
        <span className="sub num">{m.score.toLocaleString("en-US")} 分</span>
      )}
      {open ? (
        <div className="suspend-form">
          <select className="select" value={level} aria-label="指定等級" onChange={(e) => setLevel(e.target.value)} data-testid="level-select">
            <option value="">選等級</option>
            {LEVELS.map((_, i) => (
              <option key={i} value={i + 1}>
                {levelLabel(i + 1)}
              </option>
            ))}
          </select>
          <input className="input" value={reason} placeholder="原因（必填）" aria-label="指定原因" onChange={(e) => setReason(e.target.value)} data-testid="level-reason" />
          <button type="button" className="btn btn-line" onClick={() => void run("set_level")} data-testid="level-confirm">
            確定指定
          </button>
          <button type="button" className="btn btn-text" onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      ) : (
        <span className="level-actions">
          <button type="button" className="btn-text" onClick={() => setOpen(true)} data-testid="level-open">
            指定等級
          </button>
          {m.override ? (
            <button type="button" className="btn-text" onClick={() => void run("clear_level")} data-testid="level-clear">
              取消指定
            </button>
          ) : null}
        </span>
      )}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
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
              <th>等級</th>
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
                  <LevelCell m={m} done={() => void load()} />
                </td>
                <td>
                  {STATUS[m.status] ?? m.status}
                  {m.suspendReason ? (
                    <span className="sub" data-testid="suspend-reason">
                      {m.suspendReason}
                    </span>
                  ) : null}
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
