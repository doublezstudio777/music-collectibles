"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { DeletionRow } from "@/lib/server/deletion";

const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const RESULT: [string, string][] = [
  ["sessions", "登入狀態"],
  ["userActivity", "活動紀錄"],
  ["userGeo", "國家紀錄"],
  ["nameChanges", "改名紀錄"],
  ["photos", "照片"],
  ["avatars", "大頭貼"],
];

/** 一筆待處理：勾「連同照片一起刪除」→ 打帳號名確認 → 執行（不能還原） */
function Pending({ d, done }: { d: DeletionRow; done: () => void }) {
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  // 預設照會員申請時的選擇（2026-10-01 起會員自己選）
  const [photos, setPhotos] = useState(d.deletePhotos);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setError("");
    setBusy(true);
    const r = await api("/api/admin/deletions/execute", { body: { id: d.id, deletePhotos: photos, confirm } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    done();
  };
  return (
    <li className="del-item" data-request={d.id} data-testid="del-pending">
      <div className="del-head">
        <b>{d.user.name}</b>
        <span className="sub">@{d.user.handle}</span>
        <span className="sub mono">{d.user.email}</span>
      </div>
      <p className="sub">
        申請 {time(d.createdAt)}・註冊 {time(d.user.createdAt)}・炫收藏 {d.user.posts} 則・照片 {d.user.photos} 張（{mb(d.user.photoBytes)}）
      </p>
      <p className={d.overdue ? "field-error" : "sub"} data-testid="del-due">
        處理期限 {time(d.dueAt).slice(0, 10)}（申請後 30 日）{d.overdue ? "・已逾期" : ""}・會員選擇{d.deletePhotos ? "一併刪除照片" : "保留照片"}
      </p>
      <p className="del-reason">{d.reason}</p>
      <label className="check">
        <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} data-testid="del-photos" />
        <span>連同照片一起刪除（照會員申請時的選擇）</span>
      </label>
      {step === "idle" ? (
        <div className="settings-row">
          <button type="button" className="btn btn-line" onClick={() => setStep("confirm")} data-testid="del-execute">
            執行
          </button>
        </div>
      ) : (
        <div className="del-confirm" data-testid="del-confirm-box">
          <p className="page-meta">
            執行後不能還原：Email、密碼、登入與活動紀錄、所在地區會刪除，暱稱改成「已刪除的會員」
            {photos ? "，照片也會從儲存空間刪除" : "，照片保留（執行後要重燒浮水印，改成匿名代號）"}。確認請打出帳號名「{d.user.handle}」。
          </p>
          <div className="settings-row">
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="確認帳號名" autoComplete="off" data-testid="del-confirm" />
            <button type="button" className="btn btn-line" onClick={run} disabled={busy || confirm !== d.user.handle} data-testid="del-confirm-go">
              {busy ? "處理中…" : "確定刪除"}
            </button>
            <button type="button" className="btn-text" onClick={() => setStep("idle")}>
              取消
            </button>
          </div>
        </div>
      )}
      {error ? <p className="field-error">{error}</p> : null}
    </li>
  );
}

export function AdminDeletions() {
  const [list, setList] = useState<DeletionRow[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ list: DeletionRow[] }>("/api/admin/deletions");
    if (r.ok) setList(r.data.list);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  if (error) return <p className="empty">{error}</p>;
  if (!list) return null;
  const pending = list.filter((d) => d.status === "pending");
  const reburn = list.filter((d) => d.status === "done" && !d.reburnedAt);
  const handled = list.filter((d) => d.status !== "pending");
  return (
    <div data-testid="deletions">
      <section className="block">
        <h2 className="block-title">
          待處理<span className="count">{pending.length}</span>
        </h2>
        {pending.length ? (
          <ul className="del-list">
            {pending.map((d) => (
              <Pending key={d.id} d={d} done={() => void load()} />
            ))}
          </ul>
        ) : (
          <p className="empty">沒有待處理的申請</p>
        )}
      </section>
      {reburn.length ? (
        <section className="block" data-testid="del-reburn">
          <h2 className="block-title">
            浮水印待重燒<span className="count">{reburn.length}</span>
          </h2>
          <p className="page-meta">保留的照片浮水印還印著原帳號名，要從原圖重燒成匿名代號（使用條款第 15 條第 5 項）。在 網站/ 底下跑：</p>
          <ul className="plain-list">
            {reburn.map((d) => (
              <li key={d.id}>
                @{d.user.handle}（{d.result.reburnPending ?? "?"} 張）：<code className="mono">python3 scripts/reburn-watermark.py --remote --deletion {d.id}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="block">
        <h2 className="block-title">最近處理</h2>
        {handled.length ? (
          <div className="tbl-scroll">
            <table className="tbl admin-tbl" data-testid="del-handled">
              <thead>
                <tr>
                  <th>申請</th>
                  <th>結果</th>
                  <th>處理時間</th>
                </tr>
              </thead>
              <tbody>
                {handled.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.user.name}
                      <span className="sub">@{d.user.handle}</span>
                    </td>
                    <td>
                      {d.status === "done" ? "已刪除" : "本人取消"}
                      {d.status === "done" ? (
                        <span className="sub">
                          {RESULT.map(([k, t]) => `${t} ${d.result[k] ?? 0}`).join("・")}
                          {d.deletePhotos ? "・照片刪除" : d.reburnedAt ? "・照片保留（浮水印已匿名）" : "・照片保留（浮水印待重燒）"}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{d.handledAt ? time(d.handledAt) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">還沒有處理過的申請</p>
        )}
      </section>
    </div>
  );
}
