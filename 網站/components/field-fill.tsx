"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, whenLoggedIn } from "@/lib/account";
import { FILL_FIELDS, type FillField } from "@/lib/fill";

/** 版本的空白欄位「待補」：知道的人可以補上（只能補空白的；補別人新增的版本算「補上缺漏資料」的分數） */
export function FieldFill({ vkey, fields }: { vkey: string; fields: FillField[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<FillField | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<FillField[]>([]);
  const [busy, setBusy] = useState(false);
  const left = fields.filter((f) => !done.includes(f));
  if (!fields.length) return null;
  const send = async () => {
    if (!open) return;
    const v = value.trim();
    if (open === "year" ? !/^\d{4}$/.test(v) : !v) {
      setError(open === "year" ? "填西元四位數，例：2019" : `填一下${FILL_FIELDS[open].label}`);
      return;
    }
    setBusy(true);
    const r = await api<{ value: string }>("/api/fill", { body: { key: vkey, field: open, value: v } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setDone([...done, open]);
    setOpen(null);
    setValue("");
    setError("");
    router.refresh();
  };
  const f = open ? FILL_FIELDS[open] : null;
  return (
    <div className="year-missing" data-testid="field-missing" data-vkey={vkey}>
      {done.length ? <span role="status">已補上{done.map((d) => FILL_FIELDS[d].label).join("、")}，謝謝</span> : null}
      {left.length ? <span>待補</span> : null}
      {open && f ? (
        <span className="year-fill">
          <label className="sr-only" htmlFor={`fill-${vkey}-${open}`}>
            {f.label}
          </label>
          <input
            id={`fill-${vkey}-${open}`}
            className="input input-sm field-fill-input"
            inputMode={open === "year" ? "numeric" : undefined}
            maxLength={f.max}
            placeholder={open === "year" ? "2019" : f.label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="fill-input"
          />
          <button type="button" className="btn btn-line" onClick={() => void send()} disabled={busy} data-testid="fill-send">
            補上
          </button>
          <button type="button" className="btn-text" onClick={() => setOpen(null)}>
            取消
          </button>
        </span>
      ) : (
        left.map((k) => (
          <button
            key={k}
            type="button"
            className="btn-text"
            onClick={() => whenLoggedIn("登入後才能補資料", () => setOpen(k))}
            data-testid={`fill-open-${k}`}
          >
            {FILL_FIELDS[k].label}
          </button>
        ))
      )}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
