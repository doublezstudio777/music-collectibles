"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { LEVELS, levelLabel } from "@/lib/levels";
import type { MemberRow } from "@/lib/server/members";
import { Ava } from "@/components/ava";
import { SaveMsg, useSave } from "@/components/save-status";

// 跟 lib/server/members.ts 的 SUSPEND_REASONS 同一份（伺服器檔不能被 client 元件載入）
const REASONS = [
  ["fraud", "詐騙"],
  ["piracy", "販售盜版"],
  ["sockpuppet", "分身刷分"],
  ["spam", "洗版或騷擾"],
  ["copyright", "著作權侵權達三次"],
  ["other", "其他"],
] as const;

type Res = { members: MemberRow[]; total: number; page: number; pageSize: number };
const day = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);
const STATUS = { active: "正常", suspended: "停權", deleted: "已刪除" } as Record<string, string>;
const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

/** 改名紀錄（只有管理員看得到）：點開才查 */
function Renames({ m }: { m: MemberRow }) {
  const [list, setList] = useState<{ oldName: string; newName: string; at: string }[] | null>(null);
  if (!m.renames) return null;
  const open = async () => {
    const r = await api<{ names: { oldName: string; newName: string; at: string }[] }>(`/api/admin/members?names=${encodeURIComponent(m.id)}`);
    if (r.ok) setList(r.data.names);
  };
  return (
    <details className="renames" data-testid="renames" onToggle={(e) => (e.currentTarget.open && !list ? void open() : undefined)}>
      <summary>改名 {m.renames} 次</summary>
      {list ? (
        <ul>
          {list.map((x, i) => (
            <li key={i}>
              <span className="num">{time(x.at)}</span> {x.oldName} → {x.newName}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/** 大頭貼：有就顯示小圖＋「移除」（寫操作紀錄、R2 檔刪除） */
function AvatarCell({ m, done }: { m: MemberRow; done: () => void }) {
  const { busy, msg, run } = useSave();
  if (!m.avatar) return null;
  const remove = () => {
    if (!window.confirm(`移除「${m.name}」的大頭貼？`)) return;
    void run(async () => {
      const r = await api("/api/admin/avatar", { body: { id: m.id } });
      if (!r.ok) return { ok: false, text: r.error.message };
      done();
      return { ok: true, text: "已移除" };
    });
  };
  return (
    <span className="member-ava">
      <Ava name={m.name} src={m.avatar} />
      <button type="button" className="btn-text" onClick={remove} disabled={busy} data-testid="avatar-admin-remove">
        {busy ? "處理中…" : "移除大頭貼"}
      </button>
      <SaveMsg {...msg} />
    </span>
  );
}

function Actions({ m, done }: { m: MemberRow; done: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const save = useSave();
  if (m.admin) return <span className="sub">管理員</span>;
  if (m.status === "deleted") return null;
  const run = (action: "suspend" | "restore") =>
    save.run(async () => {
      if (action === "suspend" && !code) return { ok: false, text: "選一個停權原因" };
      const r = await api(`/api/admin/members`, { body: { id: m.id, action, reasonCode: code, note: reason } });
      if (!r.ok) return { ok: false, text: r.error.message };
      setOpen(false);
      setCode("");
      setReason("");
      done();
      return { ok: true, text: action === "suspend" ? "已停權" : "已恢復" };
    });
  if (m.status === "suspended") {
    return (
      <>
        <button type="button" className="btn btn-line" onClick={() => void run("restore")} disabled={save.busy} data-testid="restore">
          {save.busy ? "處理中…" : "恢復"}
        </button>
        <SaveMsg {...save.msg} />
      </>
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
      <button type="button" className="btn btn-line" onClick={() => void run("suspend")} disabled={save.busy} data-testid="suspend-confirm">
        {save.busy ? "處理中…" : "確定停權"}
      </button>
      <button type="button" className="btn btn-text" onClick={() => setOpen(false)}>
        取消
      </button>
      <SaveMsg {...save.msg} />
    </div>
  ) : (
    <>
      <button type="button" className="btn btn-line" onClick={() => setOpen(true)} data-testid="suspend">
        停權
      </button>
      <SaveMsg {...save.msg} />
    </>
  );
}

/** 等級欄：目前顯示的等級；可以指定（必填原因）或取消指定 */
function LevelCell({ m, done }: { m: MemberRow; done: () => void }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(String(m.override ?? ""));
  const [reason, setReason] = useState("");
  const save = useSave();
  if (m.admin) return <span>館長</span>;
  const run = (action: "set_level" | "clear_level") =>
    save.run(async () => {
      const r = await api(`/api/admin/members`, { body: { id: m.id, action, level: Number(level), reason } });
      if (!r.ok) return { ok: false, text: r.error.message };
      setOpen(false);
      setReason("");
      done();
      return { ok: true, text: "已儲存" };
    });
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
          <button type="button" className="btn btn-line" onClick={() => void run("set_level")} disabled={save.busy} data-testid="level-confirm">
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
            <button type="button" className="btn-text" onClick={() => void run("clear_level")} disabled={save.busy} data-testid="level-clear">
              取消指定
            </button>
          ) : null}
        </span>
      )}
      <SaveMsg {...save.msg} />
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
          <option value="deleted">已刪除</option>
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
                  <AvatarCell m={m} done={() => void load()} />
                  <Renames key={`${m.id}-${m.renames}`} m={m} />
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
