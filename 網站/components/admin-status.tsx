"use client";

// 後台「網站狀態」（2026-10-03 從儀表板的「用量與花費」與「檢舉與下架」頁的「網站狀態」拆出來合成一頁）：
// 照片容量、本月照片讀取、暫停模式（含手動暫停／解除）、Cloudflare 用量。資料 /api/admin/usage，暫停 /api/admin/pause
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { ConfirmDialog } from "@/components/confirm";

type Usage = {
  r2: { used: number; limit: number; free: number };
  reads: { month: number; stopAt: number; free: number };
  paused: { on: boolean; at: string | null; reason: string };
  free: { workersRequestsPerDay: number; workersCpuMs: number; d1RowsReadPerDay: number; d1RowsWrittenPerDay: number; r2ClassAPerMonth: number };
  cloudflare:
    | { configured: false; need: string }
    | { configured: true; ok: false; message: string }
    | {
        configured: true;
        ok: true;
        workers: { date: string; requests: number; errors: number; exceeded: number; cpuP50: number; cpuP90: number }[];
        d1Today: { rowsRead: number; rowsWritten: number };
        r2Month: { classA: number; classB: number };
        at: string;
      };
};

const n = (x: number) => x.toLocaleString("en-US");
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 1000) / 10 : 0}%`;
const tw = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

function Meter({ label, used, limit, text, testid }: { label: string; used: number; limit: number; text: string; testid?: string }) {
  const r = Math.min(1, limit ? used / limit : 0);
  return (
    <div className="meter" data-testid={testid}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="num">{text}</span>
      </div>
      <span className="meter-bar" aria-hidden="true">
        <span style={{ width: `${(r * 100).toFixed(1)}%` }} className={r >= 0.8 ? "is-high" : undefined} />
      </span>
    </div>
  );
}

function UsageBlock({ u, run }: { u: Usage; run: (body: { paused: boolean }) => Promise<string | void> }) {
  const [ask, setAsk] = useState(false);
  const cf = u.cloudflare;
  return (
    <section className="block" data-testid="usage">
      <h2 className="block-title">用量與花費</h2>
      <div className="meters">
        <Meter label="照片容量（上限 8 GB，免費 10 GB）" used={u.r2.used} limit={u.r2.limit} text={`${gb(u.r2.used)} / ${gb(u.r2.limit)}（${pct(u.r2.used, u.r2.limit)}）`} testid="usage-r2" />
        <Meter
          label="本月照片讀取（免費 1,000 萬次，到門檻改顯示佔位圖）"
          used={u.reads.month}
          limit={u.reads.stopAt}
          text={`${n(u.reads.month)} / ${n(u.reads.stopAt)}`}
          testid="usage-reads"
        />
      </div>
      <p className="usage-line" data-testid="usage-paused">
        暫停模式：{u.paused.on ? <b className="flag flag-lock">暫停中</b> : "正常"}
        {u.paused.on && u.paused.at ? `（${tw(u.paused.at)} · ${u.paused.reason}）` : ""}
      </p>
      {/* 原本在「檢舉與下架」頁上方的網站狀態（2026-10-03 併到這頁）：整站暫停影響所有人，要打「暫停」才能按 */}
      <div className="report-acts">
        {u.paused.on ? (
          <button type="button" className="btn btn-line" onClick={() => void run({ paused: false })} data-testid="pause-off">
            解除暫停
          </button>
        ) : (
          <button type="button" className="btn-text" onClick={() => setAsk(true)} aria-haspopup="dialog" data-testid="pause-open">
            手動暫停
          </button>
        )}
      </div>
      {ask ? (
        <ConfirmDialog
          title="暫停整個網站？"
          confirmLabel="確定暫停"
          danger
          typeWord="暫停"
          onConfirm={() => run({ paused: true })}
          onClose={() => setAsk(false)}
          testid="pause-confirm"
        >
          <p>暫停後所有人都不能上傳照片、看大圖，直到你在這裡解除暫停。</p>
        </ConfirmDialog>
      ) : null}
      <h3 className="sub-title">Cloudflare 用量</h3>
      {!cf.configured ? (
        <p className="usage-line" data-testid="cf-unset">
          <b>未設定</b>　{cf.need}
        </p>
      ) : !cf.ok ? (
        <p className="usage-line" role="alert">
          {cf.message}
        </p>
      ) : (
        <>
          <div className="tbl-scroll">
            <table className="tbl" data-testid="cf-workers">
              <thead>
                <tr>
                  <th>日期（UTC）</th>
                  <th className="num">請求</th>
                  <th className="num">錯誤</th>
                  <th className="num">超過 CPU</th>
                  <th className="num">CPU p50</th>
                  <th className="num">CPU p90</th>
                </tr>
              </thead>
              <tbody>
                {cf.workers.map((w) => (
                  <tr key={w.date}>
                    <td>{w.date}</td>
                    <td className="num">
                      {n(w.requests)}
                      <span className="sub"> / {n(u.free.workersRequestsPerDay)}</span>
                    </td>
                    <td className="num">{n(w.errors)}</td>
                    <td className="num">{n(w.exceeded)}</td>
                    <td className="num">{w.cpuP50} ms</td>
                    <td className="num">{w.cpuP90} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="usage-line">
            D1 今天讀 {n(cf.d1Today.rowsRead)} / {n(u.free.d1RowsReadPerDay)} 列、寫 {n(cf.d1Today.rowsWritten)} / {n(u.free.d1RowsWrittenPerDay)} 列；
            R2 本月寫入類操作 {n(cf.r2Month.classA)} / {n(u.free.r2ClassAPerMonth)}、讀取類 {n(cf.r2Month.classB)}。CPU 為各狀態請求數加權的近似值，
            免費方案每個請求上限 {u.free.workersCpuMs} ms。資料時間 {tw(cf.at)}
          </p>
        </>
      )}
    </section>
  );
}


export function AdminStatus() {
  const [u, setU] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<Usage>("/api/admin/usage");
    if (r.ok) setU(r.data);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const run = async (body: { paused: boolean }) => {
    const r = await api("/api/admin/pause", { body });
    if (!r.ok) return r.error.message;
    await load();
  };
  if (error) return <p className="empty">{error}</p>;
  if (!u) return <p className="empty">讀取中</p>;
  return <UsageBlock u={u} run={run} />;
}
