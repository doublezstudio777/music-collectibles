"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, openPanel, refreshAccount, setMe, useAccount, type Me } from "@/lib/account";

function Msg({ ok, text }: { ok: boolean; text: string }) {
  if (!text) return null;
  return (
    <p className={ok ? "field-ok" : "field-error"} role="status">
      {text}
    </p>
  );
}

function NameBox({ me }: { me: Me }) {
  const [name, setName] = useState(me.name);
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const router = useRouter();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api<{ user: Me }>("/api/me/profile", { method: "PATCH", body: { name } });
    if (r.ok) {
      setMe(r.data.user);
      setMsg({ ok: true, text: "已儲存" });
      router.refresh();
    } else setMsg({ ok: false, text: r.error.message });
  };
  return (
    <form className="block settings-block" onSubmit={save} noValidate>
      <h2 className="block-title">顯示名稱</h2>
      <label className="sr-only" htmlFor="set-name">
        顯示名稱
      </label>
      <div className="settings-row">
        <input id="set-name" className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-line">
          儲存
        </button>
      </div>
      <Msg {...msg} />
    </form>
  );
}

function PasswordBox() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api("/api/me/password", { body: { current, password: next } });
    if (r.ok) {
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: "密碼已更新，其他裝置已登出" });
    } else setMsg({ ok: false, text: r.error.message });
  };
  return (
    <form className="block settings-block" onSubmit={save} noValidate>
      <h2 className="block-title">改密碼</h2>
      <label className="field-label" htmlFor="set-cur">
        目前的密碼
      </label>
      <input id="set-cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label className="field-label" htmlFor="set-new">
        新密碼（至少 8 個字）
      </label>
      <input id="set-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      <div className="settings-row">
        <button type="submit" className="btn btn-line">
          更新密碼
        </button>
      </div>
      <Msg {...msg} />
    </form>
  );
}

function SessionsBox() {
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const router = useRouter();
  const run = async () => {
    const r = await api("/api/auth/logout-all", { body: {} });
    if (!r.ok) return setMsg({ ok: false, text: r.error.message });
    await refreshAccount();
    router.push("/");
  };
  return (
    <section className="block settings-block">
      <h2 className="block-title">登出所有裝置</h2>
      <p className="page-meta">手機、別台電腦、這台都會登出。</p>
      <div className="settings-row">
        <button type="button" className="btn btn-line" onClick={run}>
          登出所有裝置
        </button>
      </div>
      <Msg {...msg} />
    </section>
  );
}

/** 刪除帳號：這輪只做申請（確認流程），實際刪除策略待使用者確認 */
function DeleteBox({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api("/api/me/delete", { body: { handle, password } });
    if (r.ok) {
      await refreshAccount();
      setOpen(false);
    } else setMsg({ ok: false, text: r.error.message });
  };
  const cancel = async () => {
    await api("/api/me/delete", { method: "DELETE" });
    await refreshAccount();
  };
  return (
    <section className="block settings-block" data-testid="delete-box">
      <h2 className="block-title">刪除帳號</h2>
      {me.deletionRequested ? (
        <>
          <p className="page-meta" data-testid="delete-requested">
            已收到刪除申請。音藏會人工處理，處理前帳號照常可用。
          </p>
          <div className="settings-row">
            <button type="button" className="btn-text" onClick={cancel}>
              取消申請
            </button>
          </div>
        </>
      ) : open ? (
        <form onSubmit={submit} noValidate>
          <p className="page-meta">確認要刪除，請輸入帳號名「{me.handle}」和密碼。</p>
          <label className="field-label" htmlFor="del-handle">
            帳號名
          </label>
          <input id="del-handle" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="off" />
          <label className="field-label" htmlFor="del-pw">
            密碼
          </label>
          <input id="del-pw" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="settings-row">
            <button type="submit" className="btn btn-danger">
              申請刪除
            </button>
            <button type="button" className="btn-text" onClick={() => setOpen(false)}>
              取消
            </button>
          </div>
          <Msg {...msg} />
        </form>
      ) : (
        <div className="settings-row">
          <button type="button" className="btn btn-line" onClick={() => setOpen(true)}>
            刪除帳號…
          </button>
        </div>
      )}
    </section>
  );
}

export function SettingsForm() {
  const { status, me } = useAccount();
  if (status === "loading") return null;
  if (!me) {
    return (
      <p className="empty">
        登入後才能改設定
        <button type="button" className="btn btn-p empty-btn" onClick={() => openPanel("login")}>
          登入
        </button>
      </p>
    );
  }
  return (
    <div className="settings">
      <p className="page-meta">{me.email}</p>
      <NameBox key={me.id} me={me} />
      <PasswordBox />
      <SessionsBox />
      <DeleteBox me={me} />
    </div>
  );
}
