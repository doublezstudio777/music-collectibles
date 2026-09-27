"use client";

import { useEffect, useState } from "react";
import { GENDER_LABEL, REGION_LABEL, type ArtistGender, type ArtistRegion } from "@/lib/data";
import { api } from "@/lib/account";

type Side = {
  slug: string;
  name: string;
  aliases: string[];
  kind: "藝人" | "發行單位";
  gender: ArtistGender | null;
  region: ArtistRegion | null;
  hasWiki: boolean;
  seriesCount: number;
  shareCount: number;
};
type Pair = { pairKey: string; reason: string; a: Side; b: Side };
type Impact = { series: number; shares: number; holdings: number; deals: number; follows: number; dismissals: number; revisions: number; decisions: number; locks: number };

const impactLine = (i: Impact) =>
  `系列 ${i.series} 個、炫收藏 ${i.shares} 則、我有／想要 ${i.holdings} 筆、成交紀錄 ${i.deals} 筆、追蹤 ${i.follows} 筆、不感興趣 ${i.dismissals} 筆、` +
  `編輯紀錄 ${i.revisions} 筆、裁決 ${i.decisions} 筆、頁面鎖定 ${i.locks} 筆`;

function SideCard({ s }: { s: Side }) {
  return (
    <div className="dup-side">
      <b>{s.name}</b>
      <span className="sub">
        {s.slug}・{s.kind}
        {s.gender ? `・${GENDER_LABEL[s.gender]}` : ""}
        {s.region ? `・${REGION_LABEL[s.region]}` : ""}
      </span>
      <span className="sub">
        維基簡介：{s.hasWiki ? "有" : "沒有"}・系列 {s.seriesCount} 個・收藏 {s.shareCount} 則
      </span>
      {s.aliases.length ? <span className="sub">別名：{s.aliases.join("、")}</span> : null}
    </div>
  );
}

function PairRow({ pair, onDone }: { pair: Pair; onDone: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [keep, setKeep] = useState<"a" | "b">("a");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (hidden) return null;
  const keepSide = keep === "a" ? pair.a : pair.b;
  const loseSide = keep === "a" ? pair.b : pair.a;

  const preview = async () => {
    setBusy(true);
    setError("");
    const r = await api<Impact>("/api/admin/duplicates/preview", { body: { keep: keepSide.slug, lose: loseSide.slug } });
    setBusy(false);
    if (r.ok) setImpact(r.data);
    else setError(r.error.message);
  };

  const confirm = async () => {
    setBusy(true);
    setError("");
    const r = await api<Impact>("/api/admin/duplicates/merge", { body: { keep: keepSide.slug, lose: loseSide.slug } });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error.message);
  };

  const dismiss = async () => {
    setBusy(true);
    setError("");
    const r = await api("/api/admin/duplicates/dismiss", { body: { a: pair.a.slug, b: pair.b.slug } });
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error.message);
  };

  return (
    <li className="dup-pair" data-testid="dup-pair" data-pair={pair.pairKey}>
      <p className="dup-reason">{pair.reason}</p>
      <div className="dup-sides">
        <SideCard s={pair.a} />
        <SideCard s={pair.b} />
      </div>
      <div className="dup-keep" role="group" aria-label="保留哪一位">
        <label className="check-inline">
          <input type="radio" name={`keep-${pair.pairKey}`} checked={keep === "a"} onChange={() => { setKeep("a"); setImpact(null); }} data-testid="dup-keep-a" />
          保留「{pair.a.name}」
        </label>
        <label className="check-inline">
          <input type="radio" name={`keep-${pair.pairKey}`} checked={keep === "b"} onChange={() => { setKeep("b"); setImpact(null); }} data-testid="dup-keep-b" />
          保留「{pair.b.name}」
        </label>
      </div>
      {impact ? (
        <p className="dup-impact" role="status" data-testid="dup-impact">
          會把「{loseSide.name}」併進「{keepSide.name}」：{impactLine(impact)}
        </p>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
      <div className="report-acts">
        {impact ? (
          <button type="button" className="btn btn-p" disabled={busy} onClick={confirm} data-testid="dup-confirm">
            確認合併
          </button>
        ) : (
          <button type="button" className="btn btn-line" disabled={busy} onClick={preview} data-testid="dup-preview">
            預覽合併
          </button>
        )}
        <button type="button" className="btn-text" disabled={busy} onClick={dismiss} data-testid="dup-not-duplicate">
          不是重複
        </button>
        <button type="button" className="btn-text" disabled={busy} onClick={() => setHidden(true)} data-testid="dup-later">
          稍後處理
        </button>
      </div>
    </li>
  );
}

/**
 * 疑似重複藝人（2026-09-28 表單藝人預設）：偵測規則見 lib/server/duplicates.ts。
 * 合併不能復原，一律先「預覽合併」看會搬動幾筆再「確認合併」。
 */
export function AdminDuplicates() {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    void api<{ pairs: Pair[] }>("/api/admin/duplicates").then((r) => {
      if (r.ok) setPairs(r.data.pairs);
      else setError(r.error.message);
    });
  };
  useEffect(load, []);

  if (error) return <p className="empty">{error}</p>;
  if (!pairs) return <p className="empty">讀取中</p>;

  return (
    <section className="block" data-testid="duplicates">
      <h2 className="block-title">
        疑似重複藝人<span className="count">{pairs.length}</span>
      </h2>
      <p className="sub">
        偵測規則：中文名完全相同、名稱互相前綴或後綴包含、英文別名重疊或一方別名等於對方中文名。
        點「不是重複」的組合之後不會再列出；「稍後處理」只是這次先跳過，下次重新整理還會再出現。
      </p>
      {pairs.length === 0 ? <p className="empty">目前沒有偵測到疑似重複的藝人</p> : null}
      <ul className="dup-list">
        {pairs.map((p) => (
          <PairRow key={p.pairKey} pair={p} onDone={load} />
        ))}
      </ul>
    </section>
  );
}
