"use client";

import { useEffect, useRef, useState } from "react";
import { QUESTION_REASONS } from "@/lib/data";
import { api, refreshAccount, requireLogin, useAccount } from "@/lib/account";
import { uploadImage } from "@/lib/image";

/** 沒登入按了「有疑問」：登入後回到這頁要直接打開對話框（面板登入本來就留在原頁；換頁再回來靠這個記號） */
const FLAG = "yz_question";
const FLAG_TTL = 30 * 60_000;

function readFlag(n: number) {
  try {
    const raw = sessionStorage.getItem(FLAG);
    if (!raw) return false;
    const f = JSON.parse(raw) as { n: number; at: number };
    return f.n === n && Date.now() - f.at < FLAG_TTL;
  } catch {
    return false;
  }
}
const setFlag = (n: number) => {
  try {
    sessionStorage.setItem(FLAG, JSON.stringify({ n, at: Date.now() }));
  } catch {
    /* 無痕模式存不了就算了，面板登入仍會直接打開 */
  }
};
const clearFlag = () => {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* 同上 */
  }
};

type Reason = (typeof QUESTION_REASONS)[number]["key"];

/**
 * 單則頁最下方「對這則收藏有疑問嗎？」（2026-09-28）：點了彈出對話框（手機從下方滑出）。
 * 七個原因分兩路：疑似盜版仿冒、疑似詐騙、照片或文字不妥＝檢舉（計門檻，只有已驗證 Email 算數、一人一次）；
 * 資料有誤、不是這位藝人、重複發文、其他＝錯誤回報（只進後台佇列）。發文者自己看不到這一行。
 */
export function ShareQuestion({ n, author }: { n: number; author: string }) {
  const acc = useAccount();
  const [open, setOpen] = useState(false);
  const mine = acc.me?.handle === author;

  // 登入回來：記號對得上這則就直接打開
  useEffect(() => {
    if (acc.status === "user" && !mine && readFlag(n)) {
      clearFlag();
      // 外部狀態（sessionStorage 記號）對上了才打開，只會發生一次
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [acc.status, mine, n]);

  if (mine) return null;
  const start = () => {
    if (acc.status === "user") return setOpen(true);
    setFlag(n);
    requireLogin("登入後才能回報", () => {
      clearFlag();
      setOpen(true);
    });
  };
  return (
    <div className="question" data-testid="question">
      <button type="button" className="question-btn" onClick={start} data-testid="question-open" aria-haspopup="dialog">
        對這則收藏有疑問嗎？
      </button>
      {open ? <QuestionDialog n={n} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function QuestionDialog({ n, onClose }: { n: number; onClose: () => void }) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ id: string; thumb: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  // onClose 每次重畫都是新的函式；放 ref 裡，下面的效果只在打開時跑一次（不然打字時焦點會被搶回第一個選項）
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // 開著的時候：Esc 關、背景不捲動、焦點進對話框，關掉回到原本的按鈕
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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setError("");
    try {
      const r = await uploadImage(f, "appeal");
      if (r.ok) setPhoto({ id: r.data.id, thumb: r.data.thumbUrl });
      else setError(r.error.code === "STORAGE_FULL" || r.error.code === "UPLOAD_PAUSED" ? "上傳暫停，可以先不附照片" : r.error.message);
    } catch {
      setError("這張讀不出來，換一張");
    }
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("選一個原因");
    setBusy(true);
    setError("");
    const r = await api<{ kind: "report" | "error" }>("/api/reports", {
      body: { target: `share:${n}`, reason, note: note.trim(), ...(photo ? { photoId: photo.id } : {}) },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error.code === "ALREADY_REPORTED") setError("你已經檢舉過這則了");
      else if (r.error.code === "NOT_VERIFIED") setError("驗證 Email 後才能檢舉這類問題；資料有誤、重複發文這類可以直接回報");
      else setError(r.error.message);
      return;
    }
    setDone(true);
    if (r.data.kind === "report") await refreshAccount();
  };

  return (
    <div className="q-layer" data-testid="question-layer">
      <div className="q-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="q-dialog" role="dialog" aria-modal="true" aria-labelledby="q-title" ref={box} data-testid="question-dialog">
        <span className="q-grip" aria-hidden="true" />
        {done ? (
          <div className="q-done">
            <p className="q-title" id="q-title" role="status" data-testid="question-done">
              已收到，謝謝你的回報
            </p>
            <button type="button" className="btn btn-line" onClick={onClose}>
              關閉
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="q-title" id="q-title">
              對這則收藏有疑問嗎？
            </p>
            <fieldset className="q-reasons">
              <legend className="sr-only">原因</legend>
              {QUESTION_REASONS.map((r) => (
                <label key={r.key} className="q-reason">
                  <input type="radio" name="q-reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} data-kind={r.kind} />
                  <span>{r.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="field-label q-label" htmlFor="q-note">
              補充說明 <span className="opt">選填</span>
            </label>
            <textarea
              id="q-note"
              className="input textarea"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="question-note"
            />
            <p className="q-count sub">{note.length}／500</p>
            <span className="field-label q-label" id="q-photo">
              比對照片 <span className="opt">選填，最多 1 張</span>
            </span>
            <div className="evidence">
              {photo ? (
                <span className="q-photo">
                  <span className="evidence-ph" style={{ backgroundImage: `url(${photo.thumb})` }} role="img" aria-label="比對照片" />
                  <button type="button" className="btn-text" onClick={() => setPhoto(null)}>
                    移除
                  </button>
                </span>
              ) : (
                <label className="evidence-add">
                  <input type="file" accept="image/*" className="sr-only" aria-labelledby="q-photo" onChange={onFile} disabled={busy} data-testid="question-photo" />
                  <span>＋</span>
                </label>
              )}
            </div>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="q-acts">
              <button type="submit" className="btn btn-p" disabled={busy} data-testid="question-submit">
                {busy ? "送出中…" : "送出"}
              </button>
              <button type="button" className="btn-text" onClick={onClose}>
                取消
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
