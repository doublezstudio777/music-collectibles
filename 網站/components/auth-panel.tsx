"use client";

// 登入小面板：未登入按愛心、我有、想要、追蹤時彈出，不跳頁。
// 掛在 layout，一個站只有一個。站金鑰從伺服器（layout）傳進來。

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { clearError, closePanel, openPanel, useAccount } from "@/lib/account";
import { AuthForm } from "@/components/auth-form";
import { setTurnstileSiteKey } from "@/components/turnstile";

export function AuthPanel({ siteKey }: { siteKey: string }) {
  setTurnstileSiteKey(siteKey);
  const { panel, error, me, status } = useAccount();
  const box = useRef<HTMLDivElement>(null);
  const open = Boolean(panel);
  const router = useRouter();
  const who = useRef<string | null | undefined>(undefined);

  // 登入、登出、換帳號後重新讀頁面：頁面上的讚數與我有／想要人數是伺服器依登入者算的
  useEffect(() => {
    if (status === "loading") return;
    const id = me?.id ?? null;
    if (who.current !== undefined && who.current !== id) router.refresh();
    who.current = id;
  }, [me?.id, status, router]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("has-modal");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("has-modal");
      prev?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error]);

  const toast = error ? (
    <p className="toast-err" role="alert">
      {error}
    </p>
  ) : null;

  if (!panel) return toast;
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && closePanel()}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-label="登入" ref={box} data-testid="auth-panel">
        <button type="button" className="modal-x" aria-label="關閉" onClick={closePanel}>
          ×
        </button>
        <AuthForm
          key={panel.mode === "login" && !panel.email ? "p" : `p-${panel.email}`}
          idp="panel"
          mode={panel.mode}
          setMode={(m) => openPanel(m, panel.reason, panel.email)}
          reason={panel.reason}
          initialEmail={panel.email}
        />
      </div>
      {toast}
    </div>
  );
}
