"use client";

// 舊會員補同意視窗（2026-10-01 法務修正 M2，文字照法務審閱 D3）。
// 登入後 /api/me 回 termsOk=false 就跳；按「稍後再說」這個分頁不再自動跳，但發布、出價、投稿被 API 擋下（TERMS_REQUIRED）時會再打開。
// 沒同意前可以瀏覽，不能發布、出價、投稿。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, closeConsent, refreshAccount, useAccount } from "@/lib/account";
import { TERMS_EFFECTIVE, TERMS_VERSION } from "@/lib/legal";
import { SITE_NAME } from "@/lib/data";

export function TermsConsent() {
  const { consent, me } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const open = consent && Boolean(me) && me?.termsOk === false;

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("button.btn-p")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConsent(true);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("has-modal");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("has-modal");
    };
  }, [open]);

  if (!open) return null;
  const agree = async () => {
    setBusy(true);
    setError("");
    const r = await api("/api/me/terms", { body: { version: TERMS_VERSION } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    await refreshAccount();
    closeConsent(false);
  };
  const toDelete = () => {
    closeConsent(true);
    router.push("/settings/delete");
  };
  return (
    <div className="modal">
      <div className="modal-box terms-consent" role="dialog" aria-modal="true" aria-labelledby="terms-consent-title" ref={box} data-testid="terms-consent">
        <button type="button" className="modal-x" aria-label="稍後再說" onClick={() => closeConsent(true)}>
          ×
        </button>
        <h2 className="auth-title" id="terms-consent-title">
          使用條款與隱私權政策已更新
        </h2>
        <p className="page-meta">
          版本 {TERMS_VERSION}，{TERMS_EFFECTIVE} 生效
        </p>
        <p className="terms-consent-lead">主要變更：</p>
        <ul className="plain-list terms-consent-list">
          <li>你上傳的照片以 CC BY-NC-ND 4.0 授權他人分享，並授權{SITE_NAME}在網站營運範圍內使用</li>
          <li>網站開放 Google 等搜尋引擎收錄公開頁面</li>
          <li>新增著作權侵權通知與處理程序</li>
          <li>刪除帳號在 30 日內處理，保留的照片會改成匿名浮水印</li>
        </ul>
        <p className="page-meta">
          全文：
          <Link href="/terms" target="_blank">
            使用條款
          </Link>
          、
          <Link href="/privacy" target="_blank">
            隱私權政策
          </Link>
          。同意前可以繼續瀏覽，但不能發布、出價或投稿。
        </p>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="terms-consent-acts">
          <button type="button" className="btn btn-p btn-lg" onClick={agree} disabled={busy} data-testid="terms-agree">
            {busy ? "處理中…" : "閱讀並同意"}
          </button>
          <button type="button" className="btn btn-line" onClick={toDelete} data-testid="terms-delete">
            先不要，我想刪除帳號
          </button>
        </div>
      </div>
    </div>
  );
}
