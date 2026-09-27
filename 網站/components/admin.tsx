"use client";

import { Ava } from "@/components/ava";
import Link from "next/link";
import { useEffect, useState } from "react";
import { reasonLabel, targetLevel, type ReportReason, type TargetKey } from "@/lib/data";
import { SaveMsg, useSave } from "@/components/save-status";
import { api } from "@/lib/account";
import { commentReasonLabel } from "@/lib/comment-rules";

const STATUS_WORD: Record<string, string> = { pending: "審核中", unlocked: "已解鎖", kept: "維持鎖定" };
const TYPE_WORD = { artist: "藝人", series: "系列", item: "品項", version: "版本" } as const;

type HideType = "artist" | "series" | "item" | "version" | "share";
const HIDE_WORD: Record<HideType, string> = { artist: "藝人", series: "系列", item: "品項", version: "版本", share: "炫收藏" };
const HIDE_HINT: Record<HideType, string> = {
  artist: "藝人網址識別碼，例：mountain-radio",
  series: "藝人/系列號，例：mountain-radio/1",
  item: "系列#品項，例：mountain-radio/1#cd",
  version: "系列#品項-版本，例：mountain-radio/1#cd-v1",
  share: "炫收藏號碼，例：12",
};
const DISPLAY_WORD = { auto: "自動", on: "強制顯示", off: "強制不顯示" } as const;

type Site = { paused: boolean; pausedAt: string | null; pausedReason: string; reads: number; readLimit: number; storageUsed: number; storageLimit: number };

type Overview = {
  site: Site;
  hidden: { type: HideType; key: string; title: string; at: string }[];
  display: { slug: string; name: string; display: keyof typeof DISPLAY_WORD }[];
  threshold: number;
  targets: { target: string; counts: Record<string, number>; total: number; locked: boolean; decision: "unlocked" | "kept" | null }[];
  appeals: { id: number; target: string; by: string; text: string; status: string; createdAt: string; photos: string[] }[];
  pending: { type: keyof typeof TYPE_WORD; id: string; title: string; detail: string; by: string; at: string }[];
  log: { id: number; by: string; action: string; target: string; detail: string; at: string }[];
  avatars: { target: string; userId: string; handle: string; name: string; url: string | null; counts: Record<string, number>; total: number }[];
  comments: {
    threshold: number;
    list: { id: number; share: number; body: string; at: string; by: string; handle: string; reports: number; reasons: Record<string, number>; hidden: boolean; warn: boolean }[];
  };
};

/** 被檢舉的大頭貼（2026-09-28）：移除＝R2 檔刪掉、回到暱稱字樣頭像；保留＝之後不再列出 */
function AvatarQueue({ data, run }: { data: Overview["avatars"]; run: (path: string, body: unknown) => Promise<void> }) {
  return (
    <section className="block" id="avatars">
      <h2 className="block-title">
        被檢舉的大頭貼<span className="count">{data.length}</span>
      </h2>
      {data.length === 0 ? <p className="empty">沒有被檢舉的大頭貼</p> : null}
      {data.length ? (
        <ul className="avatar-reports" data-testid="avatar-reports">
          {data.map((a) => (
            <li key={a.target} className="avatar-report" data-target={a.target}>
              <Ava name={a.name} src={a.url} size="lg" />
              <span>
                <Link className="link" href={`/u/${a.handle}`}>
                  {a.name}
                </Link>
                <span className="sub">
                  {(Object.entries(a.counts) as [ReportReason, number][]).map(([k, n]) => `${reasonLabel("avatar", k)} ${n}`).join("、")}
                </span>
              </span>
              <span className="report-acts">
                <button type="button" className="btn btn-line" onClick={() => run("/api/admin/avatar", { id: a.userId })} data-testid="avatar-remove-admin">
                  移除大頭貼
                </button>
                <button type="button" className="btn-text" onClick={() => run("/api/admin/targets", { target: a.target, decision: "kept" })} data-testid="avatar-keep">
                  保留
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** 被檢舉的留言（2026-09-28）：恢復＝之後不再自動隱藏；刪除＝軟刪除。門檻另外調 */
function CommentQueue({ data, run }: { data: Overview["comments"]; run: (path: string, body: unknown) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(draft ?? data.threshold);
    setDraft(null);
    void run("/api/admin/comments", { threshold: n });
  };
  return (
    <section className="block" id="comments">
      <h2 className="block-title">
        被檢舉的留言<span className="count">{data.list.length}</span>
      </h2>
      <form className="threshold" onSubmit={save} noValidate>
        <label htmlFor="comment-threshold">幾人檢舉就自動隱藏</label>
        <input
          id="comment-threshold"
          className="input input-num"
          inputMode="numeric"
          value={draft ?? String(data.threshold)}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        />
        <button type="submit" className="btn btn-line">
          儲存
        </button>
      </form>
      {data.list.length === 0 ? <p className="empty">沒有被檢舉的留言</p> : null}
      {data.list.length ? (
        <div className="tbl-scroll">
          <table className="tbl admin-tbl" data-testid="comment-table">
            <thead>
              <tr>
                <th>留言</th>
                <th>理由</th>
                <th className="num-col">人數</th>
                <th>處理</th>
              </tr>
            </thead>
            <tbody>
              {data.list.map((c) => (
                <tr key={c.id} data-comment={c.id}>
                  <td>
                    <span className="comment-admin-body">{c.body}</span>
                    <span className="sub">
                      {c.by}・{day(c.at)}・
                      <Link className="link" href={`/share/${c.share}#comments`}>
                        第 {c.share} 則
                      </Link>
                      {c.warn ? "・含站外交易字眼" : ""}
                    </span>
                  </td>
                  <td>{Object.entries(c.reasons).map(([k, n]) => `${commentReasonLabel(k)} ${n}`).join("、")}</td>
                  <td className="num-col num">{c.reports}</td>
                  <td>
                    {c.hidden ? <span className="flag flag-lock">已自動隱藏</span> : "未達門檻"}
                    <span className="report-acts">
                      <button type="button" className="btn btn-line" onClick={() => run("/api/admin/comments", { id: c.id, action: "restore" })}>
                        {c.hidden ? "恢復" : "保留"}
                      </button>
                      <button type="button" className="btn-text" onClick={() => run("/api/admin/comments", { id: c.id, action: "delete" })}>
                        刪除
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** 對象鍵 → 連結（不查資料庫，照網址規則組） */
function targetLink(t: string) {
  const level = targetLevel(t as TargetKey);
  const key = t.slice(t.indexOf(":") + 1);
  if (level === "share") return { name: "收藏", href: `/share/${key}`, title: `第 ${key} 則` };
  const [sk, anchor] = key.split("#");
  return { name: level === "item" ? "品項" : "版本", href: `/artist/${sk}#${anchor}`, title: key };
}

/** 台灣時間（資料庫存 UTC） */
const day = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const gb = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;
const pct = (a: number, b: number) => `${Math.round((a / b) * 1000) / 10}%`;

/** 網站狀態：暫停模式（第三道防線）、本月照片讀取（第二道）、照片容量（第一道） */
function SiteStatus({ site, run }: { site: Site; run: (path: string, body: unknown) => Promise<void> }) {
  return (
    <section className="block">
      <h2 className="block-title">網站狀態</h2>
      <dl className="spec-list site-status" data-testid="site-status">
        <div>
          <dt>暫停模式</dt>
          <dd data-paused={site.paused}>
            {site.paused ? (
              <>
                <span className="flag flag-lock">暫停中</span> {site.pausedReason}
                {site.pausedAt ? <span className="sub"> · {day(site.pausedAt)}</span> : null}
              </>
            ) : (
              "正常"
            )}
          </dd>
        </div>
        <div>
          <dt>本月照片讀取</dt>
          <dd className="num">
            {site.reads.toLocaleString("en-US")} / {site.readLimit.toLocaleString("en-US")}（{pct(site.reads, site.readLimit)}）
          </dd>
        </div>
        <div>
          <dt>照片容量</dt>
          <dd className="num">
            {gb(site.storageUsed)} / {gb(site.storageLimit)}（{pct(site.storageUsed, site.storageLimit)}）
          </dd>
        </div>
      </dl>
      <div className="report-acts">
        {site.paused ? (
          <button type="button" className="btn btn-line" onClick={() => run("/api/admin/pause", { paused: false })}>
            解除暫停
          </button>
        ) : (
          <button type="button" className="btn-text" onClick={() => run("/api/admin/pause", { paused: true })}>
            手動暫停
          </button>
        )}
      </div>
    </section>
  );
}

/** 下架：隱藏／恢復、永久刪除空頁面、藝人頁顯示 */
function Takedown({ data, run }: { data: Overview; run: (path: string, body: unknown) => Promise<void> }) {
  const [type, setType] = useState<HideType>("share");
  const [key, setKey] = useState("");
  const [mode, setMode] = useState<keyof typeof DISPLAY_WORD>("on");
  const [slugTo, setSlugTo] = useState("");
  const k = key.trim();
  return (
    <section className="block" id="hidden">
      <h2 className="block-title">
        下架<span className="count">{data.hidden.length}</span>
      </h2>
      <form className="takedown" onSubmit={(e) => e.preventDefault()} noValidate>
        <label className="sr-only" htmlFor="td-type">
          類型
        </label>
        <select id="td-type" className="select" value={type} onChange={(e) => setType(e.target.value as HideType)}>
          {(Object.keys(HIDE_WORD) as HideType[]).map((t) => (
            <option key={t} value={t}>
              {HIDE_WORD[t]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="td-key">
          {HIDE_HINT[type]}
        </label>
        <input id="td-key" className="input" value={key} placeholder={HIDE_HINT[type]} onChange={(e) => setKey(e.target.value)} />
        <span className="report-acts">
          <button type="button" className="btn btn-line" disabled={!k} onClick={() => run("/api/admin/hide", { type, key: k, hidden: true })}>
            隱藏
          </button>
          <button type="button" className="btn-text" disabled={!k} onClick={() => run("/api/admin/hide", { type, key: k, hidden: false })}>
            恢復
          </button>
          {type !== "share" ? (
            <button type="button" className="btn-text" disabled={!k} data-testid="purge" onClick={() => run("/api/admin/purge", { type, key: k })}>
              永久刪除
            </button>
          ) : null}
        </span>
        {type === "artist" ? (
          <span className="report-acts">
            <label className="sr-only" htmlFor="td-display">
              藝人頁顯示
            </label>
            <select id="td-display" className="select" value={mode} onChange={(e) => setMode(e.target.value as keyof typeof DISPLAY_WORD)}>
              {(Object.keys(DISPLAY_WORD) as (keyof typeof DISPLAY_WORD)[]).map((m) => (
                <option key={m} value={m}>
                  藝人頁{DISPLAY_WORD[m]}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-line" disabled={!k} onClick={() => run("/api/admin/display", { slug: k, mode })}>
              套用
            </button>
          </span>
        ) : null}
        {type === "artist" ? (
          <span className="report-acts">
            <label className="sr-only" htmlFor="td-slug-to">
              新的網址識別碼
            </label>
            <input
              id="td-slug-to"
              className="input"
              value={slugTo}
              placeholder="新的網址識別碼，例：cao-dong"
              onChange={(e) => setSlugTo(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-line"
              disabled={!k || !slugTo.trim()}
              data-testid="rename-artist"
              onClick={() => run("/api/admin/rename-artist", { from: k, to: slugTo.trim() }).then(() => setSlugTo(""))}
            >
              改識別碼
            </button>
            <span className="sub">舊網址會自動轉到新網址</span>
          </span>
        ) : null}
      </form>
      {data.hidden.length ? (
        <ul className="rows" data-testid="hidden-list">
          {data.hidden.map((h) => (
            <li key={`${h.type}:${h.key}`} className="hidden-row" data-hidden={`${h.type}:${h.key}`}>
              <span className="row-main">
                {HIDE_WORD[h.type]}　{h.title} <span className="mono sub">{h.key}</span>
              </span>
              <span className="sub">{day(h.at)}</span>
              <button type="button" className="btn-text" onClick={() => run("/api/admin/hide", { type: h.type, key: h.key, hidden: false })}>
                恢復
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {data.display.length ? (
        <ul className="rows" data-testid="display-list">
          {data.display.map((d) => (
            <li key={d.slug} className="hidden-row">
              <span className="row-main">
                藝人頁{DISPLAY_WORD[d.display]}　{d.name} <span className="mono sub">{d.slug}</span>
              </span>
              <button type="button" className="btn-text" onClick={() => run("/api/admin/display", { slug: d.slug, mode: "auto" })}>
                改回自動
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** 管理後台：只有管理員（ADMIN_EMAILS）看得到，頁面與 API 兩邊都擋 */
export function Admin() {
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    api<Overview>("/api/admin").then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  // 每個操作按鈕：處理中整塊停用（避免連按），成功顯示「已更新」約 3 秒，失敗顯示原因（2026-09-28 回饋一致化）
  const op = useSave();
  const run = (path: string, body: unknown) =>
    op.run(async () => {
      setError("");
      const r = await api(path, { body });
      setVersion((v) => v + 1);
      return r.ok ? { ok: true, text: "已更新" } : { ok: false, text: r.error.message };
    });

  if (!data) return error ? <p className="field-error">{error}</p> : null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(draft ?? data.threshold);
    if (!Number.isInteger(n) || n < 1) {
      setError("填 1 以上的整數");
      return;
    }
    setDraft(null);
    void run("/api/admin/threshold", { value: n });
  };

  const rows = [...data.targets].sort((a, b) => b.total - a.total);

  return (
    <div className="admin" aria-busy={op.busy}>
      {error ? (
        <p className="field-error" role="alert" data-testid="admin-error">
          {error}
        </p>
      ) : null}
      <div className="admin-toast">
        <SaveMsg {...op.msg} testid="admin-msg" />
      </div>
      <SiteStatus site={data.site} run={run} />
      <Takedown data={data} run={run} />
      <section className="block">
        <h2 className="block-title">檢舉門檻</h2>
        <form className="threshold" onSubmit={save} noValidate>
          <label htmlFor="threshold">幾人檢舉就鎖</label>
          <input
            id="threshold"
            className="input input-num"
            inputMode="numeric"
            value={draft ?? String(data.threshold)}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
          />
          <button type="submit" className="btn btn-line" disabled={op.busy}>
            {op.busy ? "儲存中…" : "儲存"}
          </button>
        </form>
      </section>

      <section className="block" id="pending">
        <h2 className="block-title">
          待審核新增<span className="count">{data.pending.length}</span>
        </h2>
        {data.pending.length === 0 ? <p className="empty">沒有待審核</p> : null}
        {data.pending.length ? (
          <div className="tbl-scroll">
            <table className="tbl admin-tbl" data-testid="pending-table">
              <thead>
                <tr>
                  <th>類型</th>
                  <th>內容</th>
                  <th>送出</th>
                  <th>處理</th>
                </tr>
              </thead>
              <tbody>
                {data.pending.map((p) => (
                  <tr key={`${p.type}-${p.id}`} data-pending={`${p.type}:${p.id}`}>
                    <td>{TYPE_WORD[p.type]}</td>
                    <td>
                      {p.title}
                      <span className="sub mono">{p.detail}</span>
                    </td>
                    <td>
                      {p.by}
                      <span className="sub">{day(p.at)}</span>
                    </td>
                    <td>
                      <span className="report-acts">
                        <button type="button" className="btn btn-line" onClick={() => run("/api/admin/submissions", { type: p.type, id: p.id, approve: true })}>
                          核准
                        </button>
                        <button type="button" className="btn-text" onClick={() => run("/api/admin/submissions", { type: p.type, id: p.id, approve: false })}>
                          退回
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="block" id="reports">
        <h2 className="block-title">
          檢舉<span className="count">{rows.length}</span>
        </h2>
        {rows.length === 0 ? <p className="empty">沒有檢舉</p> : null}
        {rows.length ? (
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
                {rows.map((r) => {
                  const d = targetLink(r.target);
                  const level = targetLevel(r.target as TargetKey);
                  return (
                    <tr key={r.target} data-target={r.target}>
                      <td>
                        <Link className="link" href={d.href}>
                          {d.title}
                        </Link>
                      </td>
                      <td>{d.name}</td>
                      <td>
                        {(Object.entries(r.counts) as [ReportReason, number][]).map(([k, n]) => `${reasonLabel(level, k)} ${n}`).join("、")}
                      </td>
                      <td className="num-col num">{r.total}</td>
                      <td>
                        {r.locked ? <span className="flag flag-lock">已鎖定</span> : r.decision === "unlocked" ? "已解鎖" : "未達門檻"}
                        {r.locked ? (
                          <button type="button" className="btn-text" onClick={() => run("/api/admin/targets", { target: r.target, decision: "unlocked" })}>
                            解鎖
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <CommentQueue data={data.comments} run={run} />

      <AvatarQueue data={data.avatars ?? []} run={run} />

      <section className="block" id="appeals">
        <h2 className="block-title">
          申訴<span className="count">{data.appeals.length}</span>
        </h2>
        {data.appeals.length === 0 ? <p className="empty">沒有申訴</p> : null}
        <ul className="appeals">
          {data.appeals.map((a) => {
            const d = targetLink(a.target);
            return (
              <li key={a.id} className="appeal" data-status={a.status} data-target={a.target}>
                <div className="appeal-head">
                  <Link className="link" href={d.href}>
                    {d.title}
                  </Link>
                  <span className="sub">
                    {d.name} · {a.by} · {day(a.createdAt)}
                  </span>
                  <span className={a.status === "pending" ? "appeal-st is-pending" : "appeal-st"}>{STATUS_WORD[a.status] ?? a.status}</span>
                </div>
                <p className="appeal-text">{a.text}</p>
                {a.photos.length ? (
                  <div className="evidence">
                    {a.photos.map((p, i) => (
                      <span key={p} className="evidence-ph" style={{ backgroundImage: `url(${p})` }} role="img" aria-label={`證據 ${i + 1}`} />
                    ))}
                  </div>
                ) : null}
                {a.status === "pending" ? (
                  <div className="report-acts">
                    <button type="button" className="btn btn-line" onClick={() => run(`/api/admin/appeals/${a.id}`, { decision: "unlocked" })}>
                      解鎖
                    </button>
                    <button type="button" className="btn btn-line" onClick={() => run(`/api/admin/appeals/${a.id}`, { decision: "kept" })}>
                      維持鎖定
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="block" id="log">
        <h2 className="block-title">
          操作紀錄<span className="count">{data.log.length}</span>
        </h2>
        {data.log.length === 0 ? <p className="empty">還沒有操作</p> : null}
        <ul className="rows" data-testid="admin-log">
          {data.log.map((l) => (
            <li key={l.id}>
              <span className="row-main">
                {l.action} <span className="mono">{l.target}</span>
              </span>
              <span className="sub">
                {l.by} · {day(l.at)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
