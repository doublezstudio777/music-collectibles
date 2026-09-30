"use client";

import Link from "next/link";
import { useState } from "react";
import { api, openPanel, refreshAccount, useAccount } from "@/lib/account";
import { DELETION_DAYS } from "@/lib/legal";

/**
 * 申請刪除帳號（2026-09-28 申請制）：填原因送出，管理員處理，不會立刻刪除。
 * 處理前帳號照常可用、可以取消。會刪什麼、留什麼寫在畫面上，跟使用條款一致。
 */
export function DeleteRequest() {
  const { status, me } = useAccount();
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  if (status === "loading") return null;
  if (!me) {
    return (
      <p className="empty">
        登入後才能申請
        <button type="button" className="btn btn-p empty-btn" onClick={() => openPanel("login")}>
          登入
        </button>
      </p>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setMsg("寫一下想刪除帳號的原因");
    setBusy(true);
    const r = await api("/api/me/delete", { body: { reason, deletePhotos: photos } });
    setBusy(false);
    if (!r.ok) return setMsg(r.error.message);
    setMsg("");
    await refreshAccount();
    setDone("已送出申請");
  };
  const cancel = async () => {
    setBusy(true);
    const r = await api("/api/me/delete", { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setMsg(r.error.message);
    setMsg("");
    await refreshAccount();
    setDone("已取消申請");
  };
  return (
    <div className="settings delete-request">
      <section className="block settings-block">
        <h2 className="block-title">刪除後會怎樣</h2>
        <ul className="plain-list">
          <li>Email、密碼、登入紀錄、所在地區、大頭貼、自我介紹、社群連結會刪除，之後不能再登入這個帳號</li>
          <li>暱稱改成「已刪除的會員」，帳號名換成一串代號</li>
          <li>炫收藏、編輯紀錄、留言、成交筆數會留在網站上，不再顯示是誰。想刪除特定內容，請在申請前自己刪除</li>
          <li>照片：可以在下面選擇一併刪除全部照片。保留的照片，浮水印上的帳號名會改成匿名代號</li>
          <li>出價、成交、私訊、檢舉與申訴紀錄保留到刪帳後 3 年，只用於處理交易糾紛與司法調查，期滿刪除</li>
          <li>已經依 CC 授權流傳到站外的照片副本不受影響；搜尋結果可能還要幾週才會更新</li>
          <li>送出後我們會在 {DELETION_DAYS} 日內處理完成，處理前帳號照常可用，也可以取消</li>
        </ul>
        <p className="page-meta">
          詳細說明見<Link href="/terms">使用條款</Link>與<Link href="/privacy">隱私權政策</Link>。
        </p>
      </section>
      {me.deletionRequested ? (
        <section className="block settings-block" data-testid="delete-requested">
          <p className="page-meta">已收到申請，管理員處理中。</p>
          {done ? (
            <p className="field-ok" role="status" data-testid="delete-msg">
              {done}
            </p>
          ) : null}
          <div className="settings-row">
            <button type="button" className="btn btn-line" onClick={cancel} disabled={busy} data-testid="delete-cancel">
              {busy ? "處理中…" : "取消申請"}
            </button>
          </div>
          {msg ? (
            <p className="field-error" role="alert">
              {msg}
            </p>
          ) : null}
        </section>
      ) : (
        <form className="block settings-block" onSubmit={submit} noValidate data-testid="delete-form">
          <label className="field-label" htmlFor="del-reason">
            原因
          </label>
          <textarea id="del-reason" className="input textarea" rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} data-testid="delete-photos" />
            <span>一併刪除我上傳的全部照片</span>
          </label>
          <div className="settings-row">
            <button type="submit" className="btn btn-line" disabled={busy}>
              {busy ? "送出中…" : "送出申請"}
            </button>
            <Link className="btn-text" href="/settings">
              返回設定
            </Link>
          </div>
          {done ? (
            <p className="field-ok" role="status" data-testid="delete-msg">
              {done}
            </p>
          ) : null}
          {msg ? (
            <p className="field-error" role="alert">
              {msg}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
