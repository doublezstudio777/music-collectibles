"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, openPanel, useAccount, whenLoggedIn } from "@/lib/account";

/**
 * 私訊入口（2026-10-01）：單則頁（綁那則收藏，出售中叫「問賣家」、其他叫「私訊」）與個人頁「傳訊息」（直接私訊）。
 * 同一人對同一則只有一條對話，按了就是找回那條；自己的收藏、自己的個人頁由呼叫端不放這顆
 */
export function DmButton({
  to,
  label,
  className = "btn btn-line",
  testid,
}: {
  /** share：單則頁；user：個人頁 */
  to: { share: number } | { user: string };
  label: string;
  className?: string;
  testid?: string;
}) {
  const router = useRouter();
  const { me } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; verify: boolean } | null>(null);
  const path = "share" in to ? `/api/shares/${to.share}/threads` : `/api/users/${encodeURIComponent(to.user)}/dm`;
  const go = () =>
    whenLoggedIn("登入後才能私訊", async () => {
      setError(null);
      setBusy(true);
      const r = await api<{ result: number }>(path, { body: {} });
      setBusy(false);
      if (r.ok) router.push(`/messages/${r.data.result}`);
      else setError({ text: r.error.message, verify: r.error.code === "EMAIL_UNVERIFIED" });
    });
  return (
    <>
      <button type="button" className={className} onClick={go} disabled={busy} data-testid={testid}>
        {label}
      </button>
      {error ? (
        <p className="field-error dm-error" role="alert">
          {error.text}
          {error.verify ? (
            <button type="button" className="btn-text" onClick={() => openPanel("verify", undefined, me?.email)}>
              驗證 Email
            </button>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
