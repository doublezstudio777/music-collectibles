"use client";

// 作者刪除自己的收藏（2026-10-02 總檢 M1）：發文者操作盒最下面一行小字，按了展開確認，再按一次才真的刪。
// 刪完回個人頁。被鎖定（檢舉達門檻）時伺服器回 423，原因直接顯示。獨立成一個檔，不碰 share-detail 的其他段落。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/account";

export function ShareDelete({ no, handle, photos }: { no: number; handle: string; photos: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    const r = await api(`/api/shares/${no}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    router.push(handle ? `/u/${handle}` : "/");
    router.refresh();
  };
  return (
    <div className="owner-delete" data-testid="owner-delete">
      {open ? (
        <div className="owner-delete-confirm" data-testid="owner-delete-confirm">
          <p className="sub">
            刪了就不能還原：這則收藏與 {photos} 張照片會從網站移除，還沒處理的出價會作廢，對話裡的人會收到通知。
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button type="button" className="btn btn-line" onClick={run} disabled={busy} data-testid="owner-delete-confirm-btn">
              {busy ? "刪除中…" : "確定刪除"}
            </button>
            <button type="button" className="btn-text" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-text owner-link owner-delete-open" onClick={() => setOpen(true)} data-testid="owner-delete-open">
          刪除這則收藏
        </button>
      )}
      {error ? (
        <p className="field-error" data-testid="owner-delete-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
