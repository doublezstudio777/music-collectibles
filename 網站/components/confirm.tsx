"use client";

// 站內確認對話框（2026-10-02 設計總檢必修 2、3）：取代一鍵送出與瀏覽器的 window.confirm。
// 沿用回報對話框的白盒（1px 黑框、直角、零陰影；手機從底部滑出）。
// - 一般確認：標題＋後果說明＋主按鈕＋取消
// - 危險操作（danger）：主按鈕黑底白字；要打確認字（typeWord）的，打對才能按
// 開著時 Esc 關、Tab 不出框、背景不捲動；關掉焦點回到原本的按鈕。

import { useEffect, useRef, useState } from "react";

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = "處理中…",
  cancelLabel = "取消",
  danger = false,
  typeWord,
  onConfirm,
  onClose,
  testid = "confirm",
}: {
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** 要打出這個字才能確認（永久刪除、整站暫停這類不可逆或影響全站的操作） */
  typeWord?: string;
  /** 回傳錯誤訊息字串＝留在對話框顯示；回傳空＝關閉 */
  onConfirm: () => Promise<string | void> | string | void;
  onClose: () => void;
  testid?: string;
}) {
  const box = useRef<HTMLFormElement>(null);
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    opener.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && box.current) {
        const els = [...box.current.querySelectorAll<HTMLElement>("button, input, textarea, [href]")].filter((x) => !x.hasAttribute("disabled"));
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const ok = !typeWord || typed.trim() === typeWord;
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await onConfirm();
      if (typeof r === "string" && r) {
        setError(r);
        setBusy(false);
        return;
      }
    } catch {
      setError("沒有送出，再試一次");
      setBusy(false);
      return;
    }
    setBusy(false);
    closeRef.current();
  };

  return (
    <div className="q-layer" data-testid={`${testid}-layer`}>
      <div className="q-backdrop" onClick={onClose} aria-hidden="true" />
      <form className="q-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={`${testid}-title`} ref={box} onSubmit={go} noValidate data-testid={testid}>
        <span className="q-grip" aria-hidden="true" />
        <p className="q-title" id={`${testid}-title`}>
          {title}
        </p>
        {children ? <div className="confirm-body">{children}</div> : null}
        {typeWord ? (
          <label className="confirm-type">
            <span>
              確認請打出「<b>{typeWord}</b>」
            </span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid={`${testid}-type`} />
          </label>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="q-acts">
          <button type="submit" className={danger ? "btn btn-danger" : "btn btn-p"} disabled={!ok || busy} data-testid={`${testid}-ok`}>
            {busy ? busyLabel : confirmLabel}
          </button>
          <button type="button" className="btn-text" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
