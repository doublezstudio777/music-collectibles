"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import type { AdminPick } from "@/lib/server/spotify-picks";

type Opt = { slug: string; name: string };

function Row({ p, reload }: { p: AdminPick; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: "enable" | "disable" | "delete") => {
    setBusy(true);
    setError("");
    const r = await api("/api/admin/spotify-picks", { body: { action, id: p.id } });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    reload();
  };
  const on = p.enabled === 1;
  return (
    <tr data-testid="sp-row" data-id={p.id} data-track={p.trackId} data-enabled={on ? "1" : "0"}>
      <td>
        {/* 一般 <a>：這張表幾十列，用 Link 會同時預先載入幾十個藝人頁 */}
        <a className="link" href={`/artist/${p.artistSlug}`} target="_blank" rel="noopener">
          {p.artistName}
        </a>
      </td>
      <td>
        <a className="link" href={`https://open.spotify.com/track/${p.trackId}`} target="_blank" rel="noopener noreferrer">
          {p.title || p.trackId}
        </a>
      </td>
      <td className="num-col-l">{on ? "啟用" : "停用"}</td>
      <td>
        <div className="ap-actions">
          <button type="button" className="btn-text" disabled={busy} onClick={() => run(on ? "disable" : "enable")} data-testid={on ? "sp-disable" : "sp-enable"}>
            {on ? "停用" : "啟用"}
          </button>
          {confirm ? (
            <>
              <button type="button" className="btn-text" disabled={busy} onClick={() => run("delete")} data-testid="sp-delete-yes">
                確定刪除
              </button>
              <button type="button" className="btn-text" disabled={busy} onClick={() => setConfirm(false)}>
                取消
              </button>
            </>
          ) : (
            <button type="button" className="btn-text" disabled={busy} onClick={() => setConfirm(true)} data-testid="sp-delete">
              刪除
            </button>
          )}
        </div>
        {error ? <p className="field-error">{error}</p> : null}
      </td>
    </tr>
  );
}

/** 後台「推薦歌曲」：首頁上方播放器的歌單 */
export function AdminSpotifyPicks() {
  const [list, setList] = useState<AdminPick[] | null>(null);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [added, setAdded] = useState("");
  const load = useCallback(async () => {
    const r = await api<{ list: AdminPick[]; artists: Opt[] }>("/api/admin/spotify-picks");
    if (r.ok) {
      setList(r.data.list);
      setOpts(r.data.artists);
    } else setError(r.error.message);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  if (error) return <p className="empty">{error}</p>;
  if (!list) return <p className="empty">讀取中</p>;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    setAdded("");
    const r = await api<{ pick: AdminPick }>("/api/admin/spotify-picks", { body: { action: "add", url, artist } });
    setBusy(false);
    if (!r.ok) return setFormError(r.error.message);
    setAdded(`已新增：${r.data.pick.artistName}${r.data.pick.title ? `・${r.data.pick.title}` : ""}`);
    setUrl("");
    void load();
  };
  const onCount = list.filter((p) => p.enabled === 1).length;
  return (
    <>
      <section className="block sp-add" data-testid="sp-add">
        <h2 className="block-title">新增</h2>
        <form className="sp-form" onSubmit={add}>
          <label className="sr-only" htmlFor="sp-url">
            Spotify 歌曲連結
          </label>
          <input
            id="sp-url"
            className="input"
            placeholder="https://open.spotify.com/track/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            data-testid="sp-url"
          />
          <label className="sr-only" htmlFor="sp-artist">
            藝人
          </label>
          <select id="sp-artist" className="input select" value={artist} onChange={(e) => setArtist(e.target.value)} data-testid="sp-artist">
            <option value="">選藝人</option>
            {opts.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-p" disabled={busy || !url.trim() || !artist} data-testid="sp-submit">
            新增
          </button>
        </form>
        {formError ? <p className="field-error">{formError}</p> : null}
        {added ? (
          <p className="sub" role="status" data-testid="sp-added">
            {added}
          </p>
        ) : null}
      </section>
      <section className="block" data-testid="sp-list">
        <h2 className="block-title">
          歌單<span className="count">{`${onCount} / ${list.length}`}</span>
        </h2>
        {list.length ? (
          <div className="tbl-scroll">
            <table className="tbl admin-tbl">
              <thead>
                <tr>
                  <th>藝人</th>
                  <th>歌曲</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <Row key={`${p.id}-${p.enabled}`} p={p} reload={() => void load()} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">還沒有歌</p>
        )}
      </section>
    </>
  );
}
