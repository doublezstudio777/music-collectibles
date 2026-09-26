"use client";

// 登入／註冊／驗證信箱／忘記密碼／重設密碼，一個元件五種模式。
// 登入小面板（auth-panel）與 /login 整頁共用。

import { useState } from "react";
import { afterLogin, api, type Me, type PanelMode } from "@/lib/account";
import { Turnstile } from "@/components/turnstile";

type Props = {
  mode: PanelMode;
  setMode: (m: PanelMode) => void;
  reason?: string;
  initialEmail?: string;
  /** id 前綴：面板與整頁同時存在時不撞 id */
  idp: string;
  onDone?: () => void;
};

const TITLE: Record<PanelMode, string> = {
  login: "登入",
  register: "註冊",
  verify: "驗證 Email",
  forgot: "忘記密碼",
  reset: "重設密碼",
};

export function AuthForm({ mode, setMode, reason, initialEmail = "", idp, onDone }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const needsTurnstile = mode === "login" || mode === "register" || mode === "forgot";

  const go = (m: PanelMode) => {
    setError("");
    setNote("");
    setCode("");
    setPassword("");
    setMode(m);
  };

  const done = async () => {
    await afterLogin();
    onDone?.();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (needsTurnstile && !token) {
      setError("等機器人驗證跑完再送出");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const r = await api<{ user: Me }>("/api/auth/login", { body: { email, password, turnstileToken: token } });
        if (r.ok) return await done();
        if (r.error.code === "EMAIL_UNVERIFIED") {
          go("verify");
          setNote(`這個 Email 還沒驗證，驗證碼已寄到 ${email}`);
          return;
        }
        setError(r.error.message);
      } else if (mode === "register") {
        const r = await api("/api/auth/register", { body: { email, password, handle, name, turnstileToken: token } });
        if (r.ok) {
          go("verify");
          setNote(`驗證碼已寄到 ${email}`);
          return;
        }
        setError(r.error.message);
      } else if (mode === "verify") {
        const r = await api<{ user: Me }>("/api/auth/verify-email", { body: { email, code } });
        if (r.ok) return await done();
        setError(r.error.message);
      } else if (mode === "forgot") {
        const r = await api("/api/auth/forgot-password", { body: { email, turnstileToken: token } });
        if (r.ok) {
          go("reset");
          setNote(`如果 ${email} 有註冊，重設碼已經寄過去了`);
          return;
        }
        setError(r.error.message);
      } else {
        const r = await api<{ user: Me }>("/api/auth/reset-password", { body: { email, code, password } });
        if (r.ok) return await done();
        setError(r.error.message);
      }
    } finally {
      setBusy(false);
      // token 用過就失效，不管成功失敗都換新的
      if (needsTurnstile) setResetKey((k) => k + 1);
    }
  };

  const resend = async () => {
    setError("");
    const r = await api("/api/auth/resend-code", { body: { email } });
    if (r.ok) setNote(`新的驗證碼已寄到 ${email}`);
    else setError(r.error.message);
  };

  const id = (f: string) => `${idp}-${f}`;
  const field = (f: string, label: string, input: React.ReactNode, hint?: string) => (
    <div className="auth-field">
      <label className="field-label" htmlFor={id(f)}>
        {label}
        {hint ? <span className="opt">{hint}</span> : null}
      </label>
      {input}
    </div>
  );

  return (
    <form className="auth-form" onSubmit={submit} noValidate data-mode={mode} aria-labelledby={id("title")}>
      <h2 className="auth-title" id={id("title")}>
        {TITLE[mode]}
      </h2>
      {reason && mode === "login" ? <p className="auth-reason">{reason}</p> : null}
      {note ? (
        <p className="auth-note" role="status">
          {note}
        </p>
      ) : null}

      {mode !== "verify" && mode !== "reset"
        ? field(
            "email",
            "Email",
            <input
              id={id("email")}
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />,
          )
        : null}

      {mode === "verify" || mode === "reset"
        ? field(
            "code",
            "6 位數驗證碼",
            <input
              id={id("code")}
              className="input mono auth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />,
          )
        : null}

      {mode === "login" || mode === "register" || mode === "reset"
        ? field(
            "password",
            mode === "reset" ? "新密碼" : "密碼",
            <input
              id={id("password")}
              className="input"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />,
            mode === "login" ? undefined : "至少 8 個字",
          )
        : null}

      {mode === "register" ? (
        <>
          {field(
            "handle",
            "帳號名",
            <input
              id={id("handle")}
              className="input mono"
              autoComplete="username"
              autoCapitalize="none"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              required
            />,
            `個人頁網址 /u/${handle || "…"}`,
          )}
          {field(
            "name",
            "顯示名稱",
            <input
              id={id("name")}
              className="input"
              autoComplete="nickname"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />,
          )}
        </>
      ) : null}

      {needsTurnstile ? <Turnstile onToken={setToken} resetKey={resetKey} /> : null}

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-p btn-lg auth-submit" disabled={busy}>
        {mode === "forgot" ? "寄重設碼" : mode === "verify" ? "驗證並登入" : mode === "reset" ? "重設並登入" : TITLE[mode]}
      </button>

      <p className="auth-links">
        {mode === "login" ? (
          <>
            <button type="button" className="link" onClick={() => go("forgot")}>
              忘記密碼
            </button>
            <span>
              還沒有帳號？
              <button type="button" className="link" onClick={() => go("register")}>
                註冊
              </button>
            </span>
          </>
        ) : mode === "verify" ? (
          <>
            <button type="button" className="link" onClick={resend}>
              重寄驗證碼
            </button>
            <button type="button" className="link" onClick={() => go("login")}>
              回登入
            </button>
          </>
        ) : (
          <span>
            {mode === "register" ? "已經有帳號？" : null}
            <button type="button" className="link" onClick={() => go("login")}>
              {mode === "register" ? "登入" : "回登入"}
            </button>
          </span>
        )}
      </p>
    </form>
  );
}
