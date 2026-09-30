"use client";

import { useState } from "react";
import { api, useAccount } from "@/lib/account";
import { prepareImage } from "@/lib/image";
import { FEEDBACK_KINDS, FEEDBACK_MAX, type FeedbackKind } from "@/lib/feedback";
import { Turnstile } from "@/components/turnstile";

/** /feedback 表單：未登入也能送（Turnstile），已登入 Email 預設帶自己的 */
export function FeedbackForm({ initialKind }: { initialKind: FeedbackKind | null }) {
  const { me, status } = useAccount();
  const [kind, setKind] = useState<FeedbackKind | "">(initialKind ?? "");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [photo, setPhoto] = useState<{ main: Blob; thumb: Blob; preview: string } | null>(null);
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // 已登入：Email 預設帶自己的（使用者自己改過就用改過的）
  const shownEmail = touchedEmail ? email : (me?.email ?? email);

  const len = Array.from(body).length;
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const p = await prepareImage(f);
      setPhoto({ main: p.main, thumb: p.thumb, preview: p.preview });
    } catch {
      setError("這張讀不出來，換一張");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) return setError("選一個類型");
    if (!body.trim()) return setError("寫一下內容");
    if (len > FEEDBACK_MAX) return setError(`內容最多 ${FEEDBACK_MAX} 字`);
    if (!me && !shownEmail.trim()) return setError("填回覆用的 Email");
    if (!token) return setError("等機器人驗證跑完再送出");
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("body", body.trim());
    fd.append("email", shownEmail.trim());
    fd.append("turnstileToken", token);
    if (photo) {
      fd.append("image", photo.main, "image");
      fd.append("thumb", photo.thumb, "thumb");
    }
    setBusy(true);
    setError("");
    const r = await api<{ id: number }>("/api/feedback", { body: fd });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      setResetKey((k) => k + 1);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <p className="fb-done" role="status" data-testid="feedback-done">
        已收到
      </p>
    );
  }
  return (
    <form className="fb-form" onSubmit={submit} noValidate data-testid="feedback-form">
      <fieldset className="q-reasons">
        <legend className="field-label">類型</legend>
        {FEEDBACK_KINDS.map((k) => (
          <label key={k.key} className="q-reason">
            <input type="radio" name="fb-kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} data-testid={`fb-kind-${k.key}`} />
            <span>{k.label}</span>
          </label>
        ))}
      </fieldset>
      {kind === "takedown" ? (
        <p className="auth-note" data-testid="fb-takedown-hint">
          認為站上的照片或內容侵害你的著作權、商標權或肖像權，請改用
          <a className="link" href="/takedown">
            權利侵害通知
          </a>
          ，會照使用條款第 11 條的程序處理。
        </p>
      ) : null}
      <label className="field-label" htmlFor="fb-body">
        內容
      </label>
      <textarea id="fb-body" className="input textarea" rows={7} value={body} onChange={(e) => setBody(e.target.value)} data-testid="fb-body" />
      <p className={`sub q-count${len > FEEDBACK_MAX ? " field-error" : ""}`}>
        {len} / {FEEDBACK_MAX}
      </p>
      <label className="field-label" htmlFor="fb-email">
        回覆用 Email {me ? <span className="opt">選填</span> : null}
      </label>
      <input
        id="fb-email"
        className="input"
        type="email"
        autoComplete="email"
        value={shownEmail}
        onChange={(e) => {
          setEmail(e.target.value);
          setTouchedEmail(true);
        }}
        disabled={status === "loading"}
        data-testid="fb-email"
      />
      <p className="field-label fb-photo-label">
        附件照片 <span className="opt">選填</span>
      </p>
      {photo ? (
        <span className="q-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.preview} alt="附件照片" width={64} height={64} className="fb-thumb" />
          <button type="button" className="btn-text" onClick={() => setPhoto(null)} data-testid="fb-photo-remove">
            移除
          </button>
        </span>
      ) : (
        <label className="btn btn-line fb-photo-btn">
          選擇照片
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e)} data-testid="fb-photo" />
        </label>
      )}
      <Turnstile onToken={setToken} resetKey={resetKey} />
      {error ? (
        <p className="field-error" role="alert" data-testid="fb-error">
          {error}
        </p>
      ) : null}
      <div className="q-acts">
        <button type="submit" className="btn btn-p" disabled={busy} data-testid="fb-submit">
          送出
        </button>
      </div>
    </form>
  );
}
