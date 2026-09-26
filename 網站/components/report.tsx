"use client";

import { useState } from "react";
import { lockLabel, reasonsFor, targetLevel, type ReportReason, type TargetKey } from "@/lib/data";
import { report, submitAppeal, targetState, useAppState } from "@/lib/state";
import { CURRENT_USER } from "@/lib/data";
import { shrink } from "@/lib/image";

const domId = (t: TargetKey) => t.replace(/[^a-z0-9]/gi, "-");

/** 達門檻的醒目標示：黑底白字，內容照常可看 */
export function LockBanner({ target, children }: { target: TargetKey; children?: React.ReactNode }) {
  const { state } = useAppState();
  if (!targetState(state, target).locked) return null;
  return (
    <div className="lock-banner" role="status" data-target={target}>
      <b>{lockLabel(targetLevel(target))}</b>
      <span>交易暫停</span>
      {children}
    </div>
  );
}

/** 檢舉：單則收藏（盜版／仿冒）、品項或版本（官方沒出過）。只有認證帳號可以送 */
export function ReportBox({ target, label = "檢舉" }: { target: TargetKey; label?: string }) {
  const { state, verified, ready } = useAppState();
  const [open, setOpen] = useState(false);
  const reasons = reasonsFor(targetLevel(target));
  const [reason, setReason] = useState<ReportReason>(reasons[0].key);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const id = `report-${domId(target)}`;
  if (!ready) return null;
  const done = targetState(state, target).mine;

  if (done) {
    return (
      <p className="report-done" data-testid="report-done">
        已檢舉
      </p>
    );
  }

  if (!open) {
    return (
      <div className="report">
        <button type="button" className="btn-text report-btn" onClick={() => setOpen(true)}>
          {label}
        </button>
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="report">
        <p className="report-note" role="status">
          認證後才能檢舉
        </p>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason === "other" && !note.trim()) {
      setError("寫一句原因");
      return;
    }
    report(target, reason, note);
  };

  return (
    <form className="report-form" onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <p className="report-title" id={`${id}-t`}>
        {label}
      </p>
      <div className="radio-row" role="radiogroup" aria-labelledby={`${id}-t`}>
        {reasons.map((r) => (
          <label key={r.key} className="radio">
            <input type="radio" name={id} value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} />
            <span>{r.label}</span>
          </label>
        ))}
      </div>
      <label className="sr-only" htmlFor={`${id}-note`}>
        補充
      </label>
      <textarea
        id={`${id}-note`}
        className="input textarea"
        rows={2}
        placeholder={reason === "other" ? "原因" : "補充（選填）"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error ? <p className="field-error">{error}</p> : null}
      <div className="report-acts">
        <button type="submit" className="btn btn-line">
          送出檢舉
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </form>
  );
}

/** 被鎖的發文者向音藏申訴：附證據照片與說明，送出後審核中 */
export function AppealBox({ target }: { target: TargetKey }) {
  const { state } = useAppState();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState("");
  const id = `appeal-${domId(target)}`;
  const mine = state.appeals.find((a) => a.target === target && a.by === CURRENT_USER);

  if (mine) {
    const word = mine.status === "pending" ? "申訴審核中" : mine.status === "unlocked" ? "申訴通過，已解鎖" : "申訴未通過";
    return (
      <p className="appeal-status" data-testid="appeal-status">
        {word}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-line appeal-btn" onClick={() => setOpen(true)}>
        向音藏申訴
      </button>
    );
  }

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 4 - photos.length);
    try {
      const out = await Promise.all(files.map((f) => shrink(f, 600)));
      setPhotos([...photos, ...out]);
    } catch {
      setError("有檔案讀不出來，換一張");
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError("寫一下正版的證據");
      return;
    }
    if (!submitAppeal(target, text, photos)) setError("瀏覽器空間不夠，少放一張照片");
  };

  return (
    <form className="appeal-form" onSubmit={submit} noValidate>
      <p className="report-title">向音藏申訴</p>
      <div className="field">
        <span className="field-label" id={`${id}-p`}>
          證據照片
        </span>
        <div className="evidence">
          {photos.map((p, i) => (
            <span key={i} className="evidence-ph" style={{ backgroundImage: `url(${p})` }} role="img" aria-label={`證據 ${i + 1}`} />
          ))}
          {photos.length < 4 ? (
            <label className="evidence-add">
              <input type="file" accept="image/*" multiple className="sr-only" aria-labelledby={`${id}-p`} onChange={onFiles} />
              <span>＋</span>
            </label>
          ) : null}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-text`}>
          說明
        </label>
        <textarea id={`${id}-text`} className="input textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="report-acts">
        <button type="submit" className="btn btn-p">
          送出申訴
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </form>
  );
}
