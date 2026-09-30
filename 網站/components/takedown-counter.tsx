"use client";

// 回復通知（2026-10-01 法務修正 M5，使用條款第 11 條第 3 項）：被通知的會員登入後看通知內容、送出回復通知。

import { useCallback, useEffect, useState } from "react";
import { api, openPanel, useAccount } from "@/lib/account";
import { RESTORE_WORKDAYS } from "@/lib/legal";

type Notice = {
  id: number;
  status: string;
  statusText: string;
  claimant: string;
  rightType: string;
  work: string;
  detail: string;
  urls: string[];
  counterAt: string | null;
  canCounter: boolean;
};

export function TakedownCounter({ id }: { id: number }) {
  const { status, me } = useAccount();
  const [n, setN] = useState<Notice | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [text, setText] = useState("");
  const [sworn, setSworn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ notice: Notice }>(`/api/takedown/${id}`);
    if (r.ok) setN(r.data.notice);
    else setLoadErr(r.error.message);
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (me) void load();
  }, [me, load]);

  if (status === "loading") return null;
  if (!me) {
    return (
      <p className="empty">
        登入後才能看通知內容
        <button type="button" className="btn btn-p empty-btn" onClick={() => openPanel("login")}>
          登入
        </button>
      </p>
    );
  }
  if (loadErr) return <p className="empty">{loadErr}</p>;
  if (!n) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError("寫明你認為沒有侵權的理由");
    if (!sworn) return setError("勾選聲明所述屬實");
    setBusy(true);
    setError("");
    const r = await api(`/api/takedown/${id}/counter`, { body: { text, sworn } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    await load();
  };
  return (
    <div data-testid="takedown-counter">
      <h2>通知 #{n.id}</h2>
      <p className="legal-meta" data-testid="counter-status">
        目前狀態：{n.statusText}
      </p>
      <ul>
        <li>通知人：{n.claimant}</li>
        <li>被侵害的權利：{n.rightType}</li>
        <li>作品或權利：{n.work}</li>
        <li>侵害情形：{n.detail}</li>
        <li>
          內容網址：
          {n.urls.map((u) => (
            <span key={u} className="mono">
              {" "}
              {u}
            </span>
          ))}
        </li>
      </ul>
      {n.canCounter ? (
        <form className="fb-form" onSubmit={submit} noValidate data-testid="counter-form">
          <h2>提出回復通知</h2>
          <p>你認為沒有侵權，寫明理由（例如照片是你本人拍攝、你有權利使用）。我們會把回復通知轉給通知人；對方在收到後 {RESTORE_WORKDAYS} 個工作日內沒有提出已經起訴的證明，我們會回復該內容。</p>
          <textarea className="input textarea" rows={6} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="回復通知理由" data-testid="counter-text" />
          <label className="check auth-agree">
            <input type="checkbox" checked={sworn} onChange={(e) => setSworn(e.target.checked)} data-testid="counter-sworn" />
            <span>我聲明以上所述屬實，並同意把這份回復通知轉給通知人。</span>
          </label>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="q-acts">
            <button type="submit" className="btn btn-p" disabled={busy} data-testid="counter-submit">
              {busy ? "送出中…" : "送出回復通知"}
            </button>
          </div>
        </form>
      ) : n.counterAt ? (
        <p className="auth-note" data-testid="counter-done">
          已收到你的回復通知，處理結果會寄到你的 Email。
        </p>
      ) : null}
    </div>
  );
}
