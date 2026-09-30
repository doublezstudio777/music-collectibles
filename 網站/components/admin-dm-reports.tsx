"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { userHref } from "@/lib/data";
import { DM_REASON_LABEL } from "@/lib/dm-rules";
import type { AdminDmReport } from "@/lib/server/dm";

type Data = { limit: number; reports: AdminDmReport[] };

const Who = ({ p }: { p: AdminDmReport["reporter"] }) =>
  p.handle && p.status !== "deleted" ? (
    <Link className="link" href={userHref(p.handle)} target="_blank">
      {p.name}
    </Link>
  ) : (
    <span>{p.name}</span>
  );

/**
 * 後台「私訊檢舉」（2026-10-01）：誰檢舉誰、理由、補充、被檢舉累計次數。
 * 不顯示任何訊息內容（隱私權政策：私訊只有對話的兩個人看得到）。要停權到「會員」頁處理
 */
export function AdminDmReports() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const r = await api<Data>("/api/admin/dm-reports");
    if (r.ok) setData(r.data);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const post = async (body: unknown, ok: string) => {
    setError("");
    setNote("");
    const r = await api("/api/admin/dm-reports", { body });
    if (!r.ok) return setError(r.error.message);
    setNote(ok);
    setDraft(null);
    await load();
  };
  if (!data) return error ? <p className="field-error">{error}</p> : null;
  const open = data.reports.filter((r) => r.status === "open").length;
  return (
    <>
      <section className="block" id="dm-limit">
        <h2 className="block-title">每日開新對話上限</h2>
        <form
          className="threshold"
          onSubmit={(e) => {
            e.preventDefault();
            void post({ limit: Number(draft ?? data.limit) }, "已儲存");
          }}
          noValidate
        >
          <label htmlFor="dm-limit-input">每人每天最多主動開幾個新對話（已經在聊的不算）</label>
          <input
            id="dm-limit-input"
            className="input mono input-num"
            inputMode="numeric"
            value={draft ?? String(data.limit)}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
            data-testid="dm-limit-input"
          />
          <button type="submit" className="btn btn-line" data-testid="dm-limit-save">
            儲存
          </button>
        </form>
        {note ? (
          <p className="field-ok" role="status">
            {note}
          </p>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
      </section>
      <section className="block" id="dm-reports">
        <h2 className="block-title">私訊檢舉{open ? `（待處理 ${open}）` : ""}</h2>
        <p className="page-meta">只列誰檢舉誰與理由，看不到訊息內容。要停權請到「會員」。</p>
        {data.reports.length === 0 ? (
          <p className="empty">目前沒有私訊檢舉</p>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl admin-tbl" data-testid="dm-report-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>檢舉人</th>
                  <th>被檢舉</th>
                  <th>理由</th>
                  <th>對話</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.map((r) => (
                  <tr key={r.id} data-id={r.id} data-status={r.status}>
                    <td>{r.time}</td>
                    <td>
                      <Who p={r.reporter} />
                    </td>
                    <td>
                      <Who p={r.reported} />
                      <span className="sub"> 累計 {r.reportedTotal} 次</span>
                    </td>
                    <td>
                      {DM_REASON_LABEL[r.reason] ?? r.reason}
                      {r.note ? <p className="er-note">{r.note}</p> : null}
                    </td>
                    <td>{r.share ? <Link className="link" href={`/share/${r.share}`} target="_blank">{`收藏 #${r.share}`}</Link> : "直接私訊"}</td>
                    <td>
                      {r.status === "open" ? (
                        <button type="button" className="btn btn-line" onClick={() => void post({ id: r.id, status: "done" }, "已標為已處理")} data-testid="dm-report-done">
                          標為已處理
                        </button>
                      ) : (
                        <>
                          已處理{r.handledBy ? `（${r.handledBy}）` : ""}{" "}
                          <button type="button" className="btn-text" onClick={() => void post({ id: r.id, status: "open" }, "已改回待處理")}>
                            改回待處理
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
