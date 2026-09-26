"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, openPanel } from "@/lib/account";
import { toParas } from "@/lib/diff";
import { useAppState } from "@/lib/state";

/**
 * 維基式編輯（藝人簡介、系列正文）。認證帳號才能改，修改說明必填；
 * 管理員鎖定的頁面只有管理員能改。送出後回到閱讀模式。
 */
export function WikiEditor({
  target,
  paras,
  baseId,
  locked,
  closeHref,
  label,
}: {
  target: string;
  paras: string[];
  baseId: number;
  locked: boolean;
  closeHref: string;
  label: string;
}) {
  const router = useRouter();
  const { me, ready } = useAppState();
  const [text, setText] = useState(paras.join("\n\n"));
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ready) return null;
  if (!me) {
    return (
      <div className="wiki-gate" data-testid="wiki-gate">
        <p>登入後才能編輯</p>
        <button type="button" className="btn btn-line" onClick={() => openPanel("login", "登入後才能編輯")}>
          登入
        </button>
        <Link className="btn-text" href={closeHref}>
          取消
        </Link>
      </div>
    );
  }
  if (!me.verified) {
    return (
      <p className="wiki-gate" data-testid="wiki-gate">
        認證後才能編輯
      </p>
    );
  }
  if (locked && !me.admin) {
    return (
      <p className="wiki-gate" data-testid="wiki-gate">
        這個頁面已被管理員鎖定，暫時不能編輯
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) {
      setError("寫一句修改說明");
      return;
    }
    setBusy(true);
    setError("");
    const r = await api<{ id: number }>("/api/revisions", { body: { target, content: toParas(text), summary, baseId } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    router.replace(closeHref);
    router.refresh();
  };

  return (
    <form className="wiki-form" onSubmit={submit} noValidate data-testid="wiki-form">
      <label className="field-label" htmlFor="wiki-text">
        {label}
      </label>
      <textarea id="wiki-text" className="input wiki-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <span className="sub">空一行分段</span>
      <label className="field-label" htmlFor="wiki-summary">
        修改說明
      </label>
      <input
        id="wiki-summary"
        className="input"
        maxLength={200}
        value={summary}
        placeholder="例：補上發行日期、修正錯字"
        onChange={(e) => setSummary(e.target.value)}
        aria-invalid={error === "寫一句修改說明" ? true : undefined}
      />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="wiki-acts">
        <button type="submit" className="btn btn-p" disabled={busy}>
          儲存
        </button>
        <Link className="btn-text" href={closeHref}>
          取消
        </Link>
      </div>
    </form>
  );
}

/** 歷史頁：還原到這一版（會新增一筆紀錄） */
export function RevertButton({ id, no }: { id: number; no: number }) {
  const router = useRouter();
  const { me, ready } = useAppState();
  const [error, setError] = useState("");
  if (!ready) return null;
  const go = async () => {
    if (!me) {
      openPanel("login", "登入後才能還原");
      return;
    }
    const r = await api(`/api/revisions/${id}/revert`, { body: {} });
    if (!r.ok) setError(r.error.message);
    else {
      setError("");
      router.refresh();
    }
  };
  return (
    <span className="revert">
      <button type="button" className="btn-text" onClick={go} aria-label={`還原到第 ${no} 版`}>
        還原到這版
      </button>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** 管理員：鎖定／解除頁面編輯 */
export function PageLockButton({ target, locked }: { target: string; locked: boolean }) {
  const router = useRouter();
  const { me } = useAppState();
  const [error, setError] = useState("");
  if (!me?.admin) return null;
  const go = async () => {
    const r = await api("/api/admin/page-lock", { body: { target, locked: !locked } });
    if (!r.ok) setError(r.error.message);
    else router.refresh();
  };
  return (
    <span className="revert">
      <button type="button" className="btn btn-line" onClick={go} data-testid="page-lock">
        {locked ? "解除鎖定" : "鎖定頁面"}
      </button>
      {error ? <span className="field-error">{error}</span> : null}
    </span>
  );
}
