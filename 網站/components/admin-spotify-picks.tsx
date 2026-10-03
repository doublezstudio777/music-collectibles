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

type DrawStatus = {
  day: string;
  enabled: number;
  withTrack: number;
  withAlbumList: number;
  albumsCached: number;
  poolRows: number;
  poolTracks: number;
  drawnToday: number;
  usedToday: { artist_albums: number; album: number; search: number };
  limits: { artist_albums: number; album: number; search: number };
  backoff: { artist_albums: string | null; album: string | null; search: string | null };
  hasKey: boolean;
  auto: AutoStatus;
};

type AutoStatus = {
  last: { at: string; checked: number; matched: { slug: string; name: string; spotifyId: string; source: string }[]; stopped: string; calls: number; queued: number } | null;
  month: string | null;
  visible: number;
  visibleAt: string | null;
  autoMatched: number;
  queue: Record<string, number>;
  unmatched: { slug: string; name: string; status: string | null; outcome: string | null; note: string; checkedAt: string | null }[];
};

const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("zh-TW", { hour12: false }) : "還沒有");
const OUTCOME: Record<string, string> = { none: "找不到", doubt: "證據不夠", shell: "空殼", gone: "已刪除", rejected: "確認不配", matched: "已對到" };
const STATUS: Record<string, string> = { queued: "排隊中", waiting: "等出現", rejected: "確認不配" };

/** Spotify 藝人自動比對（2026-10-03）：唯讀。藝人頁出現時自動比對、每月重跑一次 */
function AutoBox({ a }: { a: AutoStatus }) {
  const last = a.last;
  return (
    <section className="block" data-testid="sp-auto-match">
      <h2 className="block-title">藝人自動比對</h2>
      <p className="sub" data-testid="sp-auto-last">
        {last
          ? `上次自動比對：${when(last.at)}，比對 ${last.checked} 位、對到 ${last.matched.length} 位${last.matched.length ? `（${last.matched.map((m) => m.name).join("、")}）` : ""}${last.stopped ? `；停下原因：${last.stopped}` : ""}。`
          : "還沒有自動比對過。"}
        {`自動流程累計對到 ${a.autoMatched} 位；排隊中 ${a.queue.queued ?? 0} 位。`}
      </p>
      <p className="sub">{`藝人頁從不顯示變顯示時自動比對；每月一次重跑顯示中但還沒對到的（這個月：${a.month ?? "還沒跑"}）。只有高信心的才寫入，其餘不配。`}</p>
      <h3 className="sub-title" data-testid="sp-auto-unmatched-title">
        {`還沒對到的顯示中藝人 ${a.unmatched.length} / ${a.visible} 位`}
      </h3>
      {a.unmatched.length ? (
        <div className="tbl-scroll">
          <table className="tbl admin-tbl" data-testid="sp-auto-unmatched">
            <thead>
              <tr>
                <th>藝人</th>
                <th>狀態</th>
                <th>說明</th>
                <th>上次比對</th>
              </tr>
            </thead>
            <tbody>
              {a.unmatched.map((u) => (
                <tr key={u.slug} data-slug={u.slug}>
                  <td>
                    <a className="link" href={`/artist/${u.slug}`} target="_blank" rel="noopener">
                      {u.name}
                    </a>
                  </td>
                  <td>{u.status === "done" ? (OUTCOME[u.outcome ?? ""] ?? "比對過") : (STATUS[u.status ?? ""] ?? "還沒排")}</td>
                  <td>{u.note}</td>
                  <td>{u.checkedAt ? when(u.checkedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">顯示中的藝人都有 Spotify 了</p>
      )}
    </section>
  );
}

/** 自動抽歌狀態（2026-09-30）：唯讀，排程每天台灣 02:00～04:55 自己跑 */
function DrawBox() {
  const [st, setSt] = useState<DrawStatus | null>(null);
  useEffect(() => {
    void api<DrawStatus>("/api/admin/spotify-draw").then((r) => {
      if (r.ok) setSt(r.data);
    });
  }, []);
  if (!st) return null;
  const locked = (v: string | null) => (v ? `（鎖到 ${new Date(v).toLocaleString("zh-TW", { hour12: false })}）` : "");
  return (
    <>
      <section className="block" data-testid="sp-auto">
        <h2 className="block-title">自動抽歌</h2>
        <p className="sub">
          {st.hasKey
            ? `對應到 Spotify 的藝人 ${st.enabled} 位，已有歌 ${st.withTrack} 位；今天（${st.day}）抽了 ${st.drawnToday} 首。抽歌池累計 ${st.poolRows} 次、${st.poolTracks} 首不同的歌；已存專輯清單 ${st.withAlbumList} 位、專輯曲目 ${st.albumsCached} 張。`
            : "還沒設定 Spotify 金鑰，首頁只用下面的手動歌單。"}
        </p>
        {st.hasKey ? (
          <p className="sub">
            {`今天用掉的 Spotify 額度：專輯清單 ${st.usedToday.artist_albums}/${st.limits.artist_albums}${locked(st.backoff.artist_albums)}、專輯曲目 ${st.usedToday.album}/${st.limits.album}${locked(st.backoff.album)}、藝人比對搜尋 ${st.usedToday.search}/${st.limits.search}${locked(st.backoff.search)}`}
          </p>
        ) : null}
        <p className="sub">下面的手動歌單改當備援：只有對不到 Spotify、或還沒抽過歌的藝人，首頁才用手動歌單的歌。</p>
      </section>
      {st.auto ? <AutoBox a={st.auto} /> : null}
    </>
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
  const [filter, setFilter] = useState("");
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
  // 2026-10-02 之後再說 7：93 列沒有搜尋，加一個藝人／歌名篩選
  const needle = filter.trim().toLowerCase();
  const shown = needle ? list.filter((p) => `${p.artistName} ${p.title ?? ""} ${p.artistSlug}`.toLowerCase().includes(needle)) : list;
  return (
    <>
      <DrawBox />
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
          <>
          <label className="sr-only" htmlFor="sp-filter">
            搜尋歌單
          </label>
          <input id="sp-filter" className="input sp-filter" placeholder="搜尋藝人或歌名" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="sp-filter" />
          {needle && !shown.length ? <p className="empty">沒有符合的歌</p> : null}
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
                {shown.map((p) => (
                  <Row key={`${p.id}-${p.enabled}`} p={p} reload={() => void load()} />
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <p className="empty">還沒有歌</p>
        )}
      </section>
    </>
  );
}
