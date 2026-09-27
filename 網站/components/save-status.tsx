"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 儲存類按鈕的統一回饋（2026-09-28，使用者：改了暱稱沒反應，以為沒成功）：
 * - 按下去立刻 busy（按鈕停用、字改「儲存中…」），避免重複送出
 * - 成功：欄位旁顯示「已儲存」這類訊息約 3 秒（role="status"，讀屏念得到）
 * - 失敗：顯示伺服器給的原因（role="alert"），不自動消失
 */
export type SaveResult = { ok: boolean; text: string } | void;

export function useSave(stayMs = 3000) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>({ ok: true, text: "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = useCallback(
    (ok: boolean, text: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMsg({ ok, text });
      if (ok && text) timer.current = setTimeout(() => setMsg({ ok: true, text: "" }), stayMs);
    },
    [stayMs],
  );
  const run = useCallback(
    async (fn: () => Promise<SaveResult>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      show(true, "");
      try {
        const r = await fn();
        if (r) show(r.ok, r.text);
      } catch {
        show(false, "出了點問題，再試一次");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [show],
  );
  return { busy, msg, run, show };
}

export function SaveMsg({ ok, text, testid }: { ok: boolean; text: string; testid?: string }) {
  if (!text) return null;
  return ok ? (
    <p className="field-ok" role="status" data-testid={testid ?? "save-ok"}>
      {text}
    </p>
  ) : (
    <p className="field-error" role="alert" data-testid={testid ? `${testid}-error` : "save-error"}>
      {text}
    </p>
  );
}
