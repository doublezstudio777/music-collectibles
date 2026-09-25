"use client";

import { useState } from "react";

/** 登入、編輯、歷史、設定這類下一階段才做的入口：按了只回一行字，不做假流程 */
export function NextPhase({ label, className = "btn btn-line" }: { label: string; className?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="next-phase">
      <button type="button" className={className} onClick={() => setShown(true)}>
        {label}
      </button>
      <span className="next-phase-note" role="status">
        {shown ? "下一階段" : ""}
      </span>
    </span>
  );
}
