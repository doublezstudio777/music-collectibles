"use client";

// 正版辨識細節（辨識特徵、目錄號、條碼、逐項特徵、已知仿冒對照）：登入會員才看得到。
// 公開頁面（整頁快取，訪客與會員同一份 HTML）只放這個元件的外框；會員的瀏覽器再打 /api/details 取內容，
// 同一頁所有版本共用一次請求（一次算一次瀏覽，伺服器端有每帳號每日上限）。

import { useEffect, useSyncExternalStore } from "react";
import { FieldFill } from "@/components/field-fill";
import { isBlank } from "@/lib/fill";
import { api, openPanel } from "@/lib/account";
import type { Fake, Mark } from "@/lib/data";
import { useAppState } from "@/lib/state";

type Detail = { identifyBy: string; catalog: string; barcode: string; marks: Mark[]; fakes: Fake[] };
type Result = { status: "loading" } | { status: "ok"; versions: Record<string, Detail> } | { status: "error"; message: string };

const store = new Map<string, Result>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(skey: string, who: string) {
  const k = `${who}|${skey}`;
  if (store.has(k)) return;
  store.set(k, { status: "loading" });
  void api<{ versions: Record<string, Detail> }>(`/api/details?series=${encodeURIComponent(skey)}`).then((r) => {
    store.set(k, r.ok ? { status: "ok", versions: r.data.versions } : { status: "error", message: r.error.message });
    emit();
  });
}

function useDetails(skey: string, who: string | null): Result | null {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (who ? (store.get(`${who}|${skey}`) ?? null) : null),
    () => null,
  );
  useEffect(() => {
    if (who) load(skey, who);
  }, [skey, who]);
  return snap;
}

/** 單一版本不比較，只列有值的欄位（跟 page.tsx 同一個規則） */
const hasValue = (x: string) => Boolean(x) && x !== "—" && x !== "待查證" && x !== "無條碼";

function PhotoBlock({ caption }: { caption: string }) {
  return (
    <span className="ph-block" role="img" aria-label={`${caption}（示意）`}>
      <b>{caption}</b>
    </span>
  );
}

function Gate() {
  return (
    <p className="gate-note" data-testid="details-gate">
      <button type="button" className="btn btn-text" onClick={() => openPanel("login", "登入後查看辨識細節")}>
        登入後查看辨識細節
      </button>
    </p>
  );
}

export function IdentifyDetails({
  skey,
  vkey,
  anchor,
  hasFakes,
  gate = true,
  compact = false,
}: {
  skey: string;
  vkey: string;
  anchor: string;
  hasFakes: boolean;
  /** 訪客的「登入後查看辨識細節」要不要在這個版本出現（2026-10-02 建議 18：一個品項只出現一次） */
  gate?: boolean;
  /** 沒資料的版本收成一列時用：沒有標題，只有登入提示或已有的辨識細節 */
  compact?: boolean;
}) {
  const { me, ready } = useAppState();
  const r = useDetails(skey, me?.id ?? null);
  const d = r?.status === "ok" ? r.versions[vkey] : undefined;
  if (compact) {
    if (!ready || !me) return gate && ready ? <Gate /> : null;
    if (!d) return null;
    const marks = [
      ...(hasValue(d.identifyBy) ? [{ label: "辨識特徵", text: d.identifyBy }] : []),
      ...(hasValue(d.barcode) ? [{ label: "條碼", text: d.barcode }] : []),
      ...(hasValue(d.catalog) ? [{ label: "目錄號", text: d.catalog }] : []),
      ...d.marks,
    ] as Mark[];
    const missing = (["catalog", "identifyBy"] as const).filter((k) => isBlank(k, d[k]));
    return (
      <>
        {marks.length ? (
          <ul className="marks marks-inline" data-testid="details">
            {marks.map((m) => (
              <li key={m.label + m.text} className="mark">
                <span className="mark-text">
                  <b>{m.label}</b>
                  <span className={m.label === "條碼" || m.label === "目錄號" ? "mono" : undefined}>{m.text}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <FieldFill vkey={vkey} fields={missing} />
      </>
    );
  }

  let body: React.ReactNode;
  if (!ready) body = <p className="gate-note">讀取中</p>;
  else if (!me) body = gate ? <Gate /> : null;
  else if (!r || r.status === "loading") body = <p className="gate-note">讀取中</p>;
  else if (r.status === "error") body = <p className="gate-note" role="alert">{r.message}</p>;
  else if (d) {
    const marks = [
      ...(hasValue(d.identifyBy) ? [{ label: "辨識特徵", text: d.identifyBy }] : []),
      ...(hasValue(d.barcode) ? [{ label: "條碼", text: d.barcode }] : []),
      ...(hasValue(d.catalog) ? [{ label: "目錄號", text: d.catalog }] : []),
      ...d.marks,
    ] as Mark[];
    const missing = (["catalog", "identifyBy"] as const).filter((k) => isBlank(k, d[k]));
    body = (
      <>
      <ul className="marks" data-testid="details">
        {marks.map((m) => (
          <li key={m.label + m.text} className={m.photo ? "mark has-photo" : "mark"}>
            {m.photo ? <PhotoBlock caption={m.photo} /> : null}
            <span className="mark-text">
              <b>{m.label}</b>
              <span className={m.label === "條碼" || m.label === "目錄號" ? "mono" : undefined}>{m.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <FieldFill vkey={vkey} fields={missing} />
      </>
    );
  }

  // 訪客、而且這個版本不放登入提示：整段不畫（標題也不留）
  if (ready && !me && !gate && !hasFakes) return null;
  return (
    <>
      <h4 className="sub-title">正版辨識</h4>
      {body}
      {hasFakes ? (
        <>
          <h4 className="sub-title" id={`${anchor}-fakes`}>
            已知仿冒
          </h4>
          {!me || !d ? null : (
            d.fakes.map((f) => (
              <div key={f.name} className="fake">
                <p className="fake-head">
                  <b>{f.name}</b>
                  <span className="sub">{f.seen}</span>
                </p>
                <div className="fake-photos">
                  <figure>
                    <PhotoBlock caption="正版" />
                    <figcaption>正版</figcaption>
                  </figure>
                  <figure>
                    <PhotoBlock caption="仿冒" />
                    <figcaption>仿冒</figcaption>
                  </figure>
                </div>
                <table className="tbl fake-tbl">
                  <thead>
                    <tr>
                      <th>特徵</th>
                      <th>正版</th>
                      <th>仿冒</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.rows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.genuine}</td>
                        <td>{row.fake}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </>
      ) : null}
    </>
  );
}
