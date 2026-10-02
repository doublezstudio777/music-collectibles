"use client";

// 單則炫收藏底部的留言（2026-09-28）。
// 不進整頁快取：頁面載入後另外打 /api/comments（跟 /api/counts 讚數一樣），換帳號時重抓。
// 留言一律當純文字輸出（React 跳脫），換行用 CSS 保留。

import { Ava } from "@/components/ava";
import Link from "@/components/link";
import { ConfirmDialog } from "@/components/confirm";
import { useCallback, useEffect, useState } from "react";
import { api, openPanel, useAccount } from "@/lib/account";
import { relTime } from "@/lib/data";
import { charCount, COMMENT_MAX, COMMENT_REASONS, looksOffsite, type CommentReason } from "@/lib/comment-rules";
import { LevelTag } from "@/components/level-tag";

type C = {
  id: number;
  author: { handle: string; name: string; badge?: string; avatar?: string | null };
  body: string;
  at: string;
  mine: boolean;
  canDelete: boolean;
  reported: boolean;
  warn: boolean;
};
type ListRes = { comments: C[]; canPost: boolean; max: number };

const SCAM = "小心站外交易詐騙";

function CommentReport({ id, done, onDone }: { id: number; done: boolean; onDone: () => void }) {
  const acc = useAccount();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CommentReason>("scam");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (done) return <span className="comment-reported">已檢舉</span>;
  if (!open) {
    return (
      <button
        type="button"
        className="btn-text comment-act"
        onClick={() => (acc.status === "anon" ? openPanel("login", "登入後才能檢舉") : setOpen(true))}
      >
        檢舉
      </button>
    );
  }
  if (!acc.me?.verified) return <span className="comment-reported">認證後才能檢舉</span>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason === "other" && !note.trim()) return setError("寫一句原因");
    setBusy(true);
    const r = await api("/api/reports", { body: { target: `comment:${id}`, reason, note } });
    setBusy(false);
    if (!r.ok && r.error.code !== "ALREADY_REPORTED") return setError(r.error.message);
    setOpen(false);
    onDone();
  };
  const nid = `comment-report-${id}`;
  return (
    <form className="report-form comment-report" onSubmit={submit} noValidate aria-labelledby={`${nid}-t`}>
      <p className="report-title" id={`${nid}-t`}>
        檢舉這則留言
      </p>
      <div className="radio-row" role="radiogroup" aria-labelledby={`${nid}-t`}>
        {COMMENT_REASONS.map((r) => (
          <label key={r.key} className="radio">
            <input type="radio" name={nid} value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} />
            <span>{r.label}</span>
          </label>
        ))}
      </div>
      <label className="sr-only" htmlFor={`${nid}-note`}>
        補充
      </label>
      <textarea
        id={`${nid}-note`}
        className="input textarea"
        rows={2}
        placeholder={reason === "other" ? "原因" : "補充（選填）"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error ? <p className="field-error">{error}</p> : null}
      <div className="report-acts">
        <button type="submit" className="btn btn-line" disabled={busy}>
          {busy ? "送出中…" : "送出檢舉"}
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </form>
  );
}

export function ShareComments({ share }: { share: number }) {
  const acc = useAccount();
  const who = acc.me?.id ?? "";
  const [data, setData] = useState<ListRes | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (acc.status === "loading") return;
    let alive = true;
    api<ListRes>(`/api/comments?share=${share}`).then((r) => {
      if (!alive || !r.ok) return;
      setData(r.data);
      setNow(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [share, who, acc.status, tick]);

  const n = charCount(text);
  const over = n > COMMENT_MAX;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!text.trim()) return setError("寫點什麼再送出");
    if (over) return setError(`留言最多 ${COMMENT_MAX} 字`);
    setBusy(true);
    const r = await api("/api/comments", { body: { share, body: text } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setText("");
    reload();
  };

  // 刪留言先用站內對話框確認（2026-10-02 必修 3：不用瀏覽器的 window.confirm）
  const [removing, setRemoving] = useState<number | null>(null);
  const remove = async () => {
    if (removing === null) return;
    const r = await api(`/api/comments/${removing}`, { method: "DELETE" });
    if (!r.ok) return r.error.message;
    reload();
  };

  const list = data?.comments ?? [];

  return (
    <section className="block comments" id="comments" data-testid="comments">
      <h2 className="block-title">
        留言<span className="count">{list.length}</span>
      </h2>
      {data && !list.length ? <p className="comment-empty">還沒有人留言</p> : null}
      {list.length ? (
        <ul className="comment-list" data-testid="comment-list">
          {list.map((c) => (
            <li key={c.id} className="comment" data-comment={c.id}>
              <p className="comment-head">
                <Link className="comment-who" href={`/u/${c.author.handle}`}>
                  <Ava name={c.author.name} src={c.author.avatar} />
                  <span>{c.author.name}</span>
                </Link>
                <LevelTag badge={c.author.badge} />
                <span className="comment-when">{relTime(c.at, now)}</span>
              </p>
              <p className="comment-body">{c.body}</p>
              {c.warn ? (
                <p className="comment-warn" role="note" data-testid="comment-warn">
                  {SCAM}
                </p>
              ) : null}
              <div className="comment-acts">
                {c.canDelete ? (
                  <button type="button" className="btn-text comment-act" data-testid="comment-delete" onClick={() => setRemoving(c.id)} aria-haspopup="dialog">
                    刪除
                  </button>
                ) : null}
                {c.mine ? null : <CommentReport id={c.id} done={c.reported} onDone={reload} />}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {acc.status === "loading" || !data ? null : acc.status === "anon" ? (
        <p className="comment-gate">
          <button type="button" className="btn btn-line" onClick={() => openPanel("login", "登入後才能留言")}>
            登入後留言
          </button>
        </p>
      ) : !data.canPost ? (
        <p className="comment-gate" data-testid="comment-unverified">
          驗證 Email 後才能留言，
          <Link className="link" href="/settings">
            到設定頁驗證
          </Link>
        </p>
      ) : (
        <form className="comment-form" onSubmit={submit} noValidate>
          <label className="sr-only" htmlFor="comment-text">
            留言
          </label>
          <textarea
            id="comment-text"
            className="input textarea comment-input"
            rows={3}
            value={text}
            placeholder="留言"
            onChange={(e) => setText(e.target.value)}
            aria-describedby="comment-count"
          />
          {looksOffsite(text) ? (
            <p className="comment-warn" role="note" data-testid="compose-warn">
              {SCAM}
            </p>
          ) : null}
          <div className="comment-form-foot">
            <span id="comment-count" className={over ? "comment-count over" : "comment-count"}>
              {n}／{COMMENT_MAX}
            </span>
            <button type="submit" className="btn btn-line" disabled={busy || over} data-testid="comment-submit">
              {busy ? "送出中…" : "送出"}
            </button>
          </div>
          {error ? (
            <p className="field-error" role="alert" data-testid="comment-error">
              {error}
            </p>
          ) : null}
        </form>
      )}
      {removing !== null ? (
        <ConfirmDialog title="刪除這則留言？" confirmLabel="確定刪除" danger onConfirm={remove} onClose={() => setRemoving(null)} testid="comment-delete-confirm">
          <p>刪掉就沒有了，不能還原。</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
