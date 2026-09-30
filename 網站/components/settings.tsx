"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api, openPanel, refreshAccount, setMe, useAccount, type Me } from "@/lib/account";
import { Ava } from "@/components/ava";
import { SaveMsg, useSave } from "@/components/save-status";
import { AvatarCropper } from "@/components/avatar-cropper";
import { ProfileExtras } from "@/components/profile-edit";

/** 台灣日期 2026-10-28 */
const twDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

function NameBox({ me }: { me: Me }) {
  const [name, setName] = useState(me.name);
  const { busy, msg, run } = useSave();
  const router = useRouter();
  const locked = Boolean(me.nameNextAt);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (name.trim() === me.name) return { ok: true, text: "暱稱沒有變" };
      const r = await api<{ user: Me }>("/api/me/profile", { method: "PATCH", body: { name } });
      if (!r.ok) return { ok: false, text: r.error.message };
      // 頁首頭像的暱稱跟著換（帳號狀態共用），伺服器畫的部分再 refresh 一次，不整頁重載
      setMe(r.data.user);
      setName(r.data.user.name);
      router.refresh();
      return { ok: true, text: "已儲存" };
    });
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
        <input id="set-name" className="input" value={name} maxLength={30} disabled={locked || busy} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-line" disabled={locked || busy} data-testid="name-save">
          {busy ? "儲存中…" : "儲存"}
        </button>
      </div>
      <SaveMsg {...msg} testid="name-msg" />
    </form>
  );
}

function AvatarBox({ me }: { me: Me }) {
  const { busy, msg, run } = useSave();
  const router = useRouter();
  // 選了檔先開裁切視窗（2026-09-30），按確定才上傳；取消就什麼都不變
  const [cropFile, setCropFile] = useState<File | null>(null);
  const done = async (text: string) => {
    await refreshAccount();
    router.refresh();
    return { ok: true, text };
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setCropFile(file);
  };
  const cancel = useCallback(() => setCropFile(null), []);
  const unreadable = useCallback(() => {
    setCropFile(null);
    void run(async () => ({ ok: false, text: "這張照片讀不到，換一張再試" }));
  }, [run]);
  const upload = (blob: Blob) => {
    setCropFile(null);
    void run(async () => {
      const form = new FormData();
      form.append("image", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
      const r = await api("/api/me/avatar", { body: form });
      return r.ok ? done("已換上新的大頭貼") : { ok: false, text: r.error.message };
    });
  };
  const remove = () =>
    void run(async () => {
      const r = await api("/api/me/avatar", { method: "DELETE" });
      return r.ok ? done("已移除大頭貼") : { ok: false, text: r.error.message };
    });
  return (
    <section className="block settings-block" data-testid="avatar-box">
      <h2 className="block-title">大頭貼</h2>
      <div className="avatar-row">
        <Ava name={me.name} src={me.avatar} size="lg" />
        <div className="avatar-acts">
          <label className="btn btn-line file-btn" aria-disabled={busy}>
            {busy ? "儲存中…" : me.avatar ? "換一張" : "上傳大頭貼"}
            <input type="file" accept="image/*" className="sr-only" onChange={pick} disabled={busy} data-testid="avatar-input" />
          </label>
          {me.avatar ? (
            <button type="button" className="btn-text" onClick={remove} disabled={busy} data-testid="avatar-remove">
              移除
            </button>
          ) : null}
          <p className="page-meta">選好照片可以拖曳、縮放調整位置。一天最多換 5 次。</p>
        </div>
      </div>
      <SaveMsg {...msg} testid="avatar-msg" />
      {cropFile ? <AvatarCropper file={cropFile} onCancel={cancel} onDone={upload} onError={unreadable} /> : null}
    </section>
  );
}

function PasswordBox() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const { busy, msg, run } = useSave(5000);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api("/api/me/password", { body: { current, password: next } });
      if (!r.ok) return { ok: false, text: r.error.message };
      setCurrent("");
      setNext("");
      return { ok: true, text: "已儲存：密碼已更新，其他裝置已登出" };
    });
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
        <button type="submit" className="btn btn-line" disabled={busy} data-testid="password-save">
          {busy ? "儲存中…" : "更新密碼"}
        </button>
      </div>
      <SaveMsg {...msg} testid="password-msg" />
    </form>
  );
}

function SessionsBox() {
  const { busy, msg, run: save } = useSave();
  const router = useRouter();
  const run = () =>
    void save(async () => {
      const r = await api("/api/auth/logout-all", { body: {} });
      if (!r.ok) return { ok: false, text: r.error.message };
      // 這台也登出了：先顯示訊息，再更新帳號狀態回首頁（先更新的話這塊會被換成「登入後才能改設定」，訊息看不到）
      setTimeout(() => void refreshAccount().then(() => router.push("/")), 1200);
      return { ok: true, text: "已登出所有裝置" };
    });
  return (
    <section className="block settings-block">
      <h2 className="block-title">登出所有裝置</h2>
      <p className="page-meta">手機、別台電腦、這台都會登出。</p>
      <div className="settings-row">
        <button type="button" className="btn btn-line" onClick={run} disabled={busy} data-testid="logout-all">
          {busy ? "處理中…" : "登出所有裝置"}
        </button>
      </div>
      <SaveMsg {...msg} testid="sessions-msg" />
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
      {/* key 只用 id：暱稱改了不能讓這塊重掛，不然「已儲存」會跟著消失（2026-09-28 使用者回報改了沒反應） */}
      <NameBox key={me.id} me={me} />
      <ProfileExtras key={`p-${me.id}`} />
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
