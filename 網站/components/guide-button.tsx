"use client";

import { useEffect, useRef, useState } from "react";
import { GuideContent } from "@/components/guide-content";

/** 個人頁（本人）「新手指南」：彈出對話框顯示跟 /guide 相同的內容；手機從底部滑出（沿用 .q-dialog） */
export function GuideButton() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>(".guide-close")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const opener = btn.current;
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open]);
  return (
    <>
      <button type="button" className="btn btn-line" ref={btn} onClick={() => setOpen(true)} data-testid="guide-open">
        新手指南
      </button>
      {open ? (
        <div className="q-layer" data-testid="guide-layer">
          <div className="q-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="q-dialog guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title" ref={box} data-testid="guide-dialog">
            <span className="q-grip" aria-hidden="true" />
            <div className="guide-dialog-head">
              <p className="q-title" id="guide-title">
                新手指南
              </p>
              <button type="button" className="btn-text guide-close" onClick={() => setOpen(false)} data-testid="guide-close">
                關閉
              </button>
            </div>
            <GuideContent headingLevel={3} />
          </div>
        </div>
      ) : null}
    </>
  );
}
