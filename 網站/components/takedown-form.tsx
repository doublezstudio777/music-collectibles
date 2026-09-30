"use client";

// 權利侵害通知表單（2026-10-01 法務修正 M5，使用條款第 11 條）。不用登入；欄位照條款第 11 條第 1 項
// （姓名與聯絡方式、被侵害的權利、站上內容的網址、權利人或代理人、聲明屬實）。

import { useState } from "react";
import { api } from "@/lib/account";
import { Turnstile } from "@/components/turnstile";

const RIGHTS = [
  ["copyright", "著作權（照片、文字、封面等被盜用）"],
  ["trademark", "商標權"],
  ["portrait", "肖像權"],
  ["other", "其他權利"],
] as const;
const ROLES = [
  ["owner", "我是權利人本人"],
  ["agent", "我是權利人的代理人（例如經紀公司、唱片公司、律師）"],
] as const;

export function TakedownForm() {
  const [f, setF] = useState({ name: "", email: "", phone: "", address: "", role: "", rightType: "", work: "", urls: "", detail: "" });
  const [sworn, setSworn] = useState(false);
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setError("填你的姓名或公司名稱");
    if (!f.email.trim()) return setError("填聯絡用的 Email");
    if (!f.role) return setError("選你是權利人本人還是代理人");
    if (!f.rightType) return setError("選被侵害的權利");
    if (!f.work.trim()) return setError("說明你的作品或權利");
    if (!f.urls.trim()) return setError("貼上站上內容的網址");
    if (!f.detail.trim()) return setError("說明侵害的情形");
    if (!sworn) return setError("勾選聲明所述屬實");
    if (!token) return setError("等機器人驗證跑完再送出");
    setBusy(true);
    setError("");
    const r = await api<{ id: number }>("/api/takedown", { body: { ...f, sworn, turnstileToken: token } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      setResetKey((k) => k + 1);
      return;
    }
    setDone(r.data.id);
  };

  if (done) {
    return (
      <div className="fb-done-box" role="status" data-testid="takedown-done">
        <p className="fb-done">已收到，通知編號 #{done}</p>
        <p className="page-meta">我們會儘快處理。之後聯絡時請附上這個編號。</p>
      </div>
    );
  }
  return (
    <form className="fb-form" onSubmit={submit} noValidate data-testid="takedown-form">
      <label className="field-label" htmlFor="td-name">
        姓名或公司名稱
      </label>
      <input id="td-name" className="input" autoComplete="name" maxLength={100} value={f.name} onChange={up("name")} data-testid="td-name" />
      <label className="field-label" htmlFor="td-email">
        Email
      </label>
      <input id="td-email" className="input" type="email" autoComplete="email" value={f.email} onChange={up("email")} data-testid="td-email" />
      <label className="field-label" htmlFor="td-phone">
        電話 <span className="opt">選填</span>
      </label>
      <input id="td-phone" className="input" type="tel" autoComplete="tel" maxLength={40} value={f.phone} onChange={up("phone")} data-testid="td-phone" />
      <label className="field-label" htmlFor="td-address">
        聯絡地址 <span className="opt">選填</span>
      </label>
      <input id="td-address" className="input" autoComplete="street-address" maxLength={200} value={f.address} onChange={up("address")} data-testid="td-address" />

      <fieldset className="q-reasons">
        <legend className="field-label">你的身分</legend>
        {ROLES.map(([k, t]) => (
          <label key={k} className="q-reason">
            <input type="radio" name="td-role" value={k} checked={f.role === k} onChange={() => setF({ ...f, role: k })} data-testid={`td-role-${k}`} />
            <span>{t}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="q-reasons">
        <legend className="field-label">被侵害的權利</legend>
        {RIGHTS.map(([k, t]) => (
          <label key={k} className="q-reason">
            <input type="radio" name="td-right" value={k} checked={f.rightType === k} onChange={() => setF({ ...f, rightType: k })} data-testid={`td-right-${k}`} />
            <span>{t}</span>
          </label>
        ))}
      </fieldset>

      <label className="field-label" htmlFor="td-work">
        你的作品或權利
      </label>
      <textarea id="td-work" className="input textarea" rows={3} maxLength={1000} value={f.work} onChange={up("work")} placeholder="例如：我在 2025 年 3 月拍攝的某張照片，原始出處網址…" data-testid="td-work" />
      <label className="field-label" htmlFor="td-urls">
        站上內容的網址 <span className="opt">一行一個，最多 10 個</span>
      </label>
      <textarea id="td-urls" className="input textarea mono" rows={3} value={f.urls} onChange={up("urls")} placeholder="https://lemibox.com/share/123" data-testid="td-urls" />
      <label className="field-label" htmlFor="td-detail">
        侵害的情形
      </label>
      <textarea id="td-detail" className="input textarea" rows={5} maxLength={2000} value={f.detail} onChange={up("detail")} data-testid="td-detail" />

      <label className="check auth-agree">
        <input type="checkbox" checked={sworn} onChange={(e) => setSworn(e.target.checked)} data-testid="td-sworn" />
        <span>我聲明以上所述屬實，我是權利人本人或經權利人授權的代理人。</span>
      </label>
      <Turnstile onToken={setToken} resetKey={resetKey} />
      {error ? (
        <p className="field-error" role="alert" data-testid="td-error">
          {error}
        </p>
      ) : null}
      <div className="q-acts">
        <button type="submit" className="btn btn-p" disabled={busy} data-testid="td-submit">
          {busy ? "送出中…" : "送出通知"}
        </button>
      </div>
    </form>
  );
}
