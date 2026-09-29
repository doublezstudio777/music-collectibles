"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, whenLoggedIn } from "@/lib/account";

/** 系列頁「發行年待補」：知道的人可以補上（只能補空白的；補別人新增的系列算「補上缺漏資料」的分數） */
export function YearFill({ skey }: { skey: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!/^\d{4}$/.test(year.trim())) {
      setError("填西元四位數，例：2019");
      return;
    }
    setBusy(true);
    const r = await api<{ year: string }>("/api/series/year", { body: { key: skey, year: year.trim() } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setDone(r.data.year);
    router.refresh();
  };
  return (
    <p className="year-missing fill-row" data-testid="year-missing">
      {done ? (
        <span role="status">已補上發行年 {done}，謝謝</span>
      ) : (
        <>
          <span>發行年待補</span>
          {open ? (
            <span className="year-fill">
              <input
                className="input input-sm"
                inputMode="numeric"
                maxLength={4}
                placeholder="2019"
                aria-label="發行年"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                data-testid="year-input"
              />
              <button type="button" className="btn btn-line" onClick={() => void send()} disabled={busy} data-testid="year-send">
                儲存
              </button>
              <button type="button" className="btn-text" onClick={() => setOpen(false)}>
                取消
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-line fill-btn" onClick={() => whenLoggedIn("登入後才能補資料", () => setOpen(true))} data-testid="year-open">
              補上
            </button>
          )}
          {error ? <span className="field-error">{error}</span> : null}
        </>
      )}
    </p>
  );
}
