"use client";

// 後台「侵權通知」（2026-10-01 法務修正 M5）：權利侵害通知的處理流程與處理紀錄。流程說明在 lib/server/copyright.ts 開頭。

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { AdminNotice } from "@/lib/server/copyright";

const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const day = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

const ACTIONS: Record<string, [string, string][]> = {
  pending: [
    ["remove", "移除內容並通知會員"],
    ["removed_manual", "已手動移除，通知會員"],
    ["reject", "通知不成立"],
  ],
  removed: [["strike", "計入侵權次數"]],
  counter: [["forward", "轉送回復通知給通知人"]],
  forwarded: [
    ["restore", "期滿，回復內容"],
    ["uphold", "通知人已起訴，維持移除"],
  ],
  upheld: [["strike", "計入侵權次數"]],
};

function Notice({ n, done }: { n: AdminNotice; done: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (action: string) => {
    setBusy(true);
    setError("");
    const r = await api("/api/admin/takedowns", { body: { id: n.id, action, note } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setNote("");
    done();
  };
  const acts = (ACTIONS[n.status] ?? []).filter(([a]) => a !== "strike" || (!n.strike && n.member));
  const overdue = n.overdue;
  return (
    <li className="del-item" data-testid="td-item" data-id={n.id} data-status={n.status}>
      <div className="del-head">
        <b>#{n.id}</b>
        <span className="sub">{n.statusText}</span>
        <span className="sub">收到 {time(n.createdAt)}</span>
      </div>
      <p className="sub">
        通知人：{n.claimant.name}（{n.claimant.role}）・<span className="mono">{n.claimant.email}</span>
        {n.claimant.phone ? `・${n.claimant.phone}` : ""}
        {n.claimant.address ? `・${n.claimant.address}` : ""}
      </p>
      <p className="sub">
        權利：{n.rightType}・會員：{n.member ? `${n.member.name} @${n.member.handle}（侵權次數 ${n.member.strikes}${n.member.status !== "active" ? `，${n.member.status === "suspended" ? "已停權" : "已刪除"}` : ""}）` : "沒有對到（網址不是 /share/N）"}
        {n.multiAuthor ? "・網址涉及多位會員，請分開處理" : ""}
        {n.strike ? "・已計入侵權次數" : ""}
      </p>
      <p className="del-reason">作品或權利：{n.work}</p>
      <p className="del-reason">侵害情形：{n.detail}</p>
      <ul className="plain-list">
        {n.urls.map((u) => (
          <li key={u}>
            <a className="link mono" href={u} target="_blank" rel="noopener noreferrer">
              {u}
            </a>
          </li>
        ))}
      </ul>
      {n.counterText ? (
        <p className="del-reason" data-testid="td-counter">
          回復通知（{n.counterAt ? time(n.counterAt) : ""}）：{n.counterText}
        </p>
      ) : null}
      {n.restoreDue ? (
        <p className={overdue ? "field-error" : "sub"}>
          通知人提出起訴證明的期限：{day(n.restoreDue)}（只扣週六日，遇國定假日要自己往後算）{overdue ? "・已過期限" : ""}
        </p>
      ) : null}
      <details className="td-log">
        <summary>處理紀錄（{n.events.length}）</summary>
        <ol className="plain-list" data-testid="td-events">
          {n.events.map((e, i) => (
            <li key={i}>
              {time(e.at)}　{e.by}　{e.action}
              {e.note ? `：${e.note}` : ""}
            </li>
          ))}
        </ol>
      </details>
      <textarea className="input textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="備註（不成立時必填）" aria-label="備註" data-testid="td-note" />
      <div className="settings-row">
        {acts.map(([a, label]) => (
          <button key={a} type="button" className={a === "reject" ? "btn btn-line" : "btn btn-p"} onClick={() => void act(a)} disabled={busy} data-testid={`td-act-${a}`}>
            {label}
          </button>
        ))}
        <button type="button" className="btn-text" onClick={() => void act("note")} disabled={busy || !note.trim()} data-testid="td-act-note">
          只存備註
        </button>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </li>
  );
}

export function AdminTakedowns() {
  const [list, setList] = useState<AdminNotice[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ list: AdminNotice[] }>("/api/admin/takedowns");
    if (r.ok) setList(r.data.list);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  if (error) return <p className="empty">{error}</p>;
  if (!list) return null;
  const open = list.filter((n) => ["pending", "removed", "counter", "forwarded"].includes(n.status));
  const closed = list.filter((n) => !open.includes(n));
  return (
    <div data-testid="takedowns">
      <p className="page-meta">
        流程：收到通知 → 移除內容並通知會員（或不成立）→ 會員可提出回復通知 → 轉送通知人 → 10 個工作日內沒提出起訴證明就回復，有就維持移除。確認侵權後按「計入侵權次數」，第 3 次自動停權。
      </p>
      <section className="block">
        <h2 className="block-title">
          處理中<span className="count">{open.length}</span>
        </h2>
        {open.length ? (
          <ul className="del-list">
            {open.map((n) => (
              <Notice key={n.id} n={n} done={() => void load()} />
            ))}
          </ul>
        ) : (
          <p className="empty">沒有處理中的通知</p>
        )}
      </section>
      <section className="block">
        <h2 className="block-title">已結案</h2>
        {closed.length ? (
          <ul className="del-list">
            {closed.map((n) => (
              <Notice key={n.id} n={n} done={() => void load()} />
            ))}
          </ul>
        ) : (
          <p className="empty">還沒有結案的通知</p>
        )}
      </section>
    </div>
  );
}
