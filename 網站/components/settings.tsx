"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, openPanel, refreshAccount, setMe, useAccount, type Me } from "@/lib/account";
import { Ava } from "@/components/ava";
import { prepareAvatar } from "@/lib/image";

function Msg({ ok, text }: { ok: boolean; text: string }) {
  if (!text) return null;
  return (
    <p className={ok ? "field-ok" : "field-error"} role="status">
      {text}
    </p>
  );
}

/** 台灣日期 2026-10-28 */
const twDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

function NameBox({ me }: { me: Me }) {
  const [name, setName] = useState(me.name);
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const router = useRouter();
  const locked = Boolean(me.nameNextAt);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === me.name) return setMsg({ ok: true, text: "暱稱沒有變" });
    const r = await api<{ user: Me }>("/api/me/profile", { method: "PATCH", body: { name } });
    if (r.ok) {
      setMe(r.data.user);
      setMsg({ ok: true, text: "已儲存" });
      router.refresh();
    } else setMsg({ ok: false, text: r.error.message });
  };
  return (
    <form className="block settings-block" onSubmit={save} noValidate data-testid="name-box">
      <h2 className="block-title">暱稱</h2>
      <p className="page-meta" data-testid="name-rule">
        {locked ? `${twDate(me.nameNextAt!)} 以後可以再改` : "每 30 天可以改一次，不能跟別人重複"}
      </p>
      <label className="sr-only" htmlFor="set-name">
        暱稱
      </label>
      <div className="settings-row">
        <input id="set-name" className="input" value={name} maxLength={30} disabled={locked} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-line" disabled={locked}>
          儲存
        </button>
      </div>
      <Msg {...msg} />
    </form>
  );
}

function AvatarBox({ me }: { me: Me }) {
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const done = async (text: string) => {
    await refreshAccount();
    setMsg({ ok: true, text });
    router.refresh();
  };
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg({ ok: true, text: "" });
    try {
      const blob = await prepareAvatar(file);
      const form = new FormData();
      form.append("image", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
      const r = await api("/api/me/avatar", { body: form });
      if (r.ok) await done("已換上新的大頭貼");
      else setMsg({ ok: false, text: r.error.message });
    } catch {
      setMsg({ ok: false, text: "這張照片讀不到，換一張再試" });
    }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    const r = await api("/api/me/avatar", { method: "DELETE" });
    if (r.ok) await done("已移除大頭貼");
    else setMsg({ ok: false, text: r.error.message });
    setBusy(false);
  };
  return (
    <section className="block settings-block" data-testid="avatar-box">
      <h2 className="block-title">大頭貼</h2>
      <div className="avatar-row">
        <Ava name={me.name} src={me.avatar} size="lg" />
        <div className="avatar-acts">
          <label className="btn btn-line file-btn">
            {me.avatar ? "換一張" : "上傳大頭貼"}
            <input type="file" accept="image/*" className="sr-only" onChange={pick} disabled={busy} data-testid="avatar-input" />
          </label>
          {me.avatar ? (
            <button type="button" className="btn-text" onClick={remove} disabled={busy} data-testid="avatar-remove">
              移除
            </button>
          ) : null}
          <p className="page-meta">照片會從中間裁成正方形。一天最多換 5 次。</p>
        </div>
      </div>
      <Msg {...msg} />
    </section>
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
      <AvatarBox me={me} />
      <NameBox key={`${me.id}-${me.name}`} me={me} />
      <PasswordBox />
      <SessionsBox />
      <p className="settings-delete">
        <Link href="/settings/delete" data-testid="delete-link">
          {me.deletionRequested ? "刪除帳號申請處理中" : "申請刪除帳號"}
        </Link>
      </p>
    </div>
  );
}
