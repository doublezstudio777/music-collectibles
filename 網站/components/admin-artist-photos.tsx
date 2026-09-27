"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { AdminArtistPhoto } from "@/lib/server/artist-photos";

const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const STATUS: Record<string, string> = {
  pending: "待審",
  active: "使用中",
  retired: "已被替換",
  rejected: "已退回",
  removed: "已撤下",
  deleted: "已刪除",
};
type Action = "activate" | "reject" | "delete" | "remove";
const CONFIRM: Partial<Record<Action, string>> = {
  remove: "撤下後藝人頁不再顯示照片，檔案會從儲存空間刪除，不能還原。確定撤下？",
  delete: "檔案會從儲存空間刪除，不能還原。確定刪除？",
};

function Item({ p, activeOf, done }: { p: AdminArtistPhoto; activeOf: (slug: string) => AdminArtistPhoto | undefined; done: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: Action) => {
    if (CONFIRM[action] && !window.confirm(CONFIRM[action])) return;
    setError("");
    setBusy(true);
    const r = await api("/api/admin/artist-photos", { body: { id: p.id, action, note } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    done();
  };
  const cur = activeOf(p.artist.slug);
  const hasFile = p.status === "pending" || p.status === "active" || p.status === "retired";
  return (
    <li className="ap-item" data-photo={p.id} data-status={p.status} data-testid="ap-item">
      {hasFile ? (
        <a href={p.url} target="_blank" rel="noopener">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.thumbUrl} alt={p.artist.name} loading="lazy" />
        </a>
      ) : (
        <span className="sub">檔案已刪除</span>
      )}
      <div className="ap-meta">
        <div>
          <a className="link" href={`/artist/${p.artist.slug}`} target="_blank" rel="noopener">
            <b>{p.artist.name}</b>
          </a>
          <span className="sub-inline">
            {" "}
            {STATUS[p.status] ?? p.status}・{p.source === "wiki" ? "維基共享資源" : "會員投稿"}
          </span>
        </div>
        <span className="sub">
          攝影：{p.submitter ? `@${p.submitter.handle}（${p.submitter.name}）` : p.author || "不詳"}・{p.license}
          {p.sourceUrl ? (
            <>
              ・
              <a className="link" href={p.sourceUrl} target="_blank" rel="noopener">
                來源
              </a>
            </>
          ) : null}
        </span>
        {p.occasion || p.occasionDate ? (
          <span className="sub">
            拍攝場合：{p.occasion}
            {p.occasion && p.occasionDate ? "・" : ""}
            {p.occasionDate}
          </span>
        ) : null}
        <span className="sub">
          {p.width}×{p.height}・{kb(p.bytes)}・{p.source === "wiki" ? "匯入" : "投稿"} {time(p.createdAt)}
          {p.handledAt ? `・處理 ${time(p.handledAt)}` : ""}
          {p.note ? `・備註：${p.note}` : ""}
        </span>
        {p.status === "pending" && cur ? <span className="sub">設為使用中會取代目前那張（{cur.source === "wiki" ? "維基共享資源" : `@${cur.submitter?.handle ?? ""}`}）</span> : null}
        {p.status !== "deleted" && p.status !== "rejected" && p.status !== "removed" ? (
          <div className="ap-actions">
            <input className="input input-sm" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="備註（選填）" aria-label="備註" />
            {p.status === "pending" || p.status === "retired" ? (
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => run("activate")} data-testid="ap-activate">
                設為使用中
              </button>
            ) : null}
            {p.status === "pending" ? (
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => run("reject")} data-testid="ap-reject">
                退回
              </button>
            ) : null}
            {p.status === "active" || p.status === "retired" ? (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run("remove")} data-testid="ap-remove">
                撤下
              </button>
            ) : null}
            {p.status !== "active" ? (
              <button type="button" className="btn-text" disabled={busy} onClick={() => run("delete")} data-testid="ap-delete">
                刪除
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    </li>
  );
}

type Data = { pending: AdminArtistPhoto[]; active: AdminArtistPhoto[]; other: AdminArtistPhoto[] };

export function AdminArtistPhotos() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const load = useCallback(async () => {
    const r = await api<Data>("/api/admin/artist-photos");
    if (r.ok) setD(r.data);
    else setError(r.error.message);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="empty">{error}</p>;
  if (!d) return <p className="empty">讀取中</p>;
  const activeOf = (slug: string) => d.active.find((x) => x.artist.slug === slug);
  const q = filter.trim().toLowerCase();
  const match = (p: AdminArtistPhoto) => !q || p.artist.name.toLowerCase().includes(q) || p.artist.slug.includes(q);
  const section = (title: string, list: AdminArtistPhoto[], empty: string, testid: string) => (
    <section className="block" data-testid={testid}>
      <h2 className="block-title">
        {title}
        <span className="count">{list.length}</span>
      </h2>
      {list.length ? (
        <ul className="ap-list">
          {list.map((p) => (
            <Item key={p.id} p={p} activeOf={activeOf} done={() => void load()} />
          ))}
        </ul>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </section>
  );
  return (
    <div data-testid="artist-photos-admin">
      {section("待審投稿", d.pending, "沒有待審的投稿", "ap-pending")}
      <div className="settings-row">
        <input className="input input-sm" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="找藝人" aria-label="找藝人" />
      </div>
      {section("使用中", d.active.filter(match), "沒有使用中的照片", "ap-active")}
      {section("最近處理", d.other.filter(match), "沒有紀錄", "ap-other")}
    </div>
  );
}
