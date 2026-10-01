"use client";

// 系列＞版本的勾選清單（2026-10-01 一次發多張）：我收藏了哪些、合集標記共用。
// 每個系列一段：年份＋名稱＋類型，下面一排點選標籤，一個版本一個；最後是「不確定版本」：
// - 系列裡只有一種東西（或還沒有任何版本）：一個「不確定版本」，記在系列層（系列鍵）
// - 同一張專輯有 CD、黑膠這類兩種以上：每種一個「CD・不確定版本」，記在品項層（品項鍵）

import { useState } from "react";
import { SERIES_KIND_LABEL, KINDS, versionLabel, type Kind } from "@/lib/data";
import type { PickSeries } from "@/lib/catalog";
import { api } from "@/lib/account";

/* ---------- 「這裡沒有，我要新增」：跟炫收藏表單同一支 API（事後審，送出後自動查 MusicBrainz 補資料） ---------- */

export type NewSeries = { kind: "album" | "ep" | "single" | "tour"; title: string; year: string };

/** 新增專輯／演唱會：成功回清單用的一段（還沒有任何版本） */
export async function submitSeries(artist: { slug: string; name: string }, f: NewSeries): Promise<PickSeries | string> {
  const r = await api<{ series: { key: string; title: string; year: string; kind: string } }>("/api/catalog/submit", {
    body: { type: "series", artist: artist.slug, title: f.title, seriesKind: f.kind, year: f.year },
  });
  if (!r.ok) return r.error.message;
  const w = r.data.series;
  return { key: w.key, title: w.title, year: w.year.slice(0, 4), kind: w.kind, artist: artist.name, items: [] };
}

/** 新增版本：成功回新的版本鍵，並把清單裡那個系列補上這個版本 */
export async function submitVersion(list: PickSeries[], seriesKey: string, f: { kind: Kind; edition: string; year: string }): Promise<{ key: string; series: PickSeries[] } | string> {
  const r = await api<{ itemId: string; version: { id: string; key: string; edition: string; year: string; region: string } }>("/api/catalog/submit", {
    body: { type: "version", seriesKey, kind: f.kind, edition: f.edition, year: f.year, region: "", barcode: "" },
  });
  if (!r.ok) return r.error.message;
  const { itemId, version: v } = r.data;
  const label = versionLabel(v, f.kind);
  const series = list.map((w) => {
    if (w.key !== seriesKey) return w;
    const items = w.items.some((it) => it.id === itemId) ? w.items : [...w.items, { id: itemId, kind: f.kind, versions: [] }];
    return { ...w, items: items.map((it) => (it.id === itemId ? { ...it, versions: [...it.versions.filter((x) => x.key !== v.key), { id: v.id, key: v.key, label }] } : it)) };
  });
  return { key: v.key, series };
}

export type Chip = { key: string; label: string; unsure: boolean };

/** 一個系列的所有可勾項目 */
export function chipsOf(w: PickSeries): Chip[] {
  const vers = w.items.flatMap((it) => it.versions.map((v) => ({ key: v.key, label: v.label, unsure: false })));
  const unsure =
    w.items.length > 1
      ? w.items.map((it) => ({ key: `${w.key}#${it.id}`, label: `${it.kind}・不確定版本`, unsure: true }))
      : [{ key: w.key, label: "不確定版本", unsure: true }];
  return [...vers, ...unsure];
}

/** 鍵屬於哪個系列 */
export const seriesOfKey = (key: string) => key.split("#")[0];

export function PickList({
  series,
  isOn,
  onToggle,
  onAddVersion,
  testid = "pick-list",
}: {
  series: PickSeries[];
  isOn: (key: string) => boolean;
  onToggle: (key: string, label: string) => void;
  /** 有給才出現「這裡沒有這個版本」：回傳錯誤訊息或 null */
  onAddVersion?: (seriesKey: string, f: { kind: Kind; edition: string; year: string }) => Promise<string | null>;
  testid?: string;
}) {
  return (
    <div className="pl" data-testid={testid}>
      {series.map((w) => (
        <section key={w.key} className="pl-series" data-key={w.key} data-testid="pl-series">
          <h3 className="pl-head">
            <span className="pl-year">{w.year || "—"}</span>
            <span className="pl-title">{w.title}</span>
            <span className="pl-kind">{SERIES_KIND_LABEL[w.kind as keyof typeof SERIES_KIND_LABEL] ?? ""}</span>
          </h3>
          <div className="picks">
            {chipsOf(w).map((c) => (
              <button
                key={c.key}
                type="button"
                className={c.unsure ? "pick pick-unsure" : "pick"}
                aria-pressed={isOn(c.key)}
                onClick={() => onToggle(c.key, c.label)}
                data-key={c.key}
                data-testid="pl-chip"
              >
                {c.label}
              </button>
            ))}
            {onAddVersion ? <AddVersion seriesKey={w.key} kinds={w.items.map((it) => it.kind)} onSave={onAddVersion} /> : null}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 「這裡沒有這個版本」：品項（CD、黑膠…）＋版本名稱＋年份，送出後立刻出現在清單裡（事後審，跟炫收藏表單同一支 API） */
function AddVersion({
  seriesKey,
  kinds,
  onSave,
}: {
  seriesKey: string;
  kinds: string[];
  onSave: (seriesKey: string, f: { kind: Kind; edition: string; year: string }) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>((kinds[0] as Kind) ?? "CD");
  const [edition, setEdition] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) {
    return (
      <button type="button" className="pick pick-add" onClick={() => setOpen(true)} data-testid="pl-add-version">
        這裡沒有，我要新增
      </button>
    );
  }
  return (
    <div className="pl-add" data-testid="pl-add-version-box">
      <div className="picks" role="group" aria-label="是什麼">
        {KINDS.filter((k) => k !== "其他周邊").map((k) => (
          <button key={k} type="button" className="pick" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="pl-add-row">
        <input className="input" value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="版本名稱，例：日版、首批限定、再版" maxLength={40} aria-label="版本名稱" />
        <input className="input pl-add-year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="年份" inputMode="numeric" aria-label="年份" />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="pl-add-acts">
        <button
          type="button"
          className="btn btn-line"
          disabled={busy || !edition.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            const e = await onSave(seriesKey, { kind, edition: edition.trim(), year });
            setBusy(false);
            if (e) setError(e);
            else {
              setOpen(false);
              setEdition("");
              setYear("");
            }
          }}
        >
          {busy ? "新增中…" : "新增版本"}
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 「這裡沒有，我要新增」：新增專輯／EP／單曲／演唱會（名稱＋年份），送出後自動查 MusicBrainz 補資料 */
export function AddSeries({ onSave }: { onSave: (f: NewSeries) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"album" | "ep" | "single" | "tour">("album");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) {
    return (
      <button type="button" className="sf-row sf-row-add pl-add-series" onClick={() => setOpen(true)} data-testid="pl-add-series">
        找不到這張？<b>這裡沒有，我要新增</b>
      </button>
    );
  }
  return (
    <div className="pl-add pl-add-box" data-testid="pl-add-series-box">
      <div className="picks" role="group" aria-label="類型">
        {(["album", "ep", "single", "tour"] as const).map((k) => (
          <button key={k} type="button" className="pick" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "tour" ? "演唱會" : SERIES_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="pl-add-row">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="名稱" maxLength={60} aria-label="名稱" data-testid="pl-add-series-name" />
        <input className="input pl-add-year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="年份" inputMode="numeric" aria-label="年份" />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="pl-add-acts">
        <button
          type="button"
          className="btn btn-line"
          disabled={busy || !title.trim()}
          data-testid="pl-add-series-save"
          onClick={async () => {
            setBusy(true);
            setError("");
            const e = await onSave({ kind, title: title.trim(), year });
            setBusy(false);
            if (e) setError(e);
            else {
              setOpen(false);
              setTitle("");
              setYear("");
            }
          }}
        >
          {busy ? "新增中…" : "新增"}
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  );
}
