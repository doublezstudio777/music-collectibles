"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/account";
import { SaveMsg, useSave } from "@/components/save-status";
import { BIO_MAX, checkBio, checkLink, FAV_MAX, SOCIALS, type Links, type SocialKey } from "@/lib/profile-rules";
import { charCount } from "@/lib/comment-rules";

// 設定頁「我的頁面」三塊（2026-09-30）：自我介紹、社群連結、最喜歡的藝人。
// 資料從 GET /api/me/profile 拿（藝人要帶名字，/api/me 不放這些），各塊各自儲存。

type Fav = { slug: string; name: string };
type Profile = { bio: string; links: Links; favArtists: Fav[] };

function BioBox({ initial }: { initial: string }) {
  const [bio, setBio] = useState(initial);
  const saved = useRef(initial);
  const { busy, msg, run } = useSave();
  const n = charCount(bio);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const c = checkBio(bio);
      if (!c.ok) return { ok: false, text: c.message };
      if (c.bio === saved.current) return { ok: true, text: "自我介紹沒有變" };
      const r = await api("/api/me/profile", { method: "PATCH", body: { bio } });
      if (!r.ok) return { ok: false, text: r.error.message };
      saved.current = c.bio;
      setBio(c.bio);
      return { ok: true, text: "已儲存" };
    });
  };
  return (
    <form className="block settings-block" onSubmit={save} noValidate data-testid="bio-box">
      <h2 className="block-title">自我介紹</h2>
      <label className="sr-only" htmlFor="set-bio">
        自我介紹
      </label>
      <textarea
        id="set-bio"
        className="input textarea bio-input"
        rows={4}
        value={bio}
        disabled={busy}
        aria-invalid={n > BIO_MAX}
        aria-describedby="set-bio-count"
        onChange={(e) => setBio(e.target.value)}
        data-testid="bio-input"
      />
      <div className="settings-row settings-row-between">
        <span id="set-bio-count" className={`field-count num${n > BIO_MAX ? " is-over" : ""}`} data-testid="bio-count">
          {n} / {BIO_MAX}
        </span>
        <button type="submit" className="btn btn-line" disabled={busy || n > BIO_MAX} data-testid="bio-save">
          {busy ? "儲存中…" : "儲存"}
        </button>
      </div>
      <SaveMsg {...msg} testid="bio-msg" />
    </form>
  );
}

function LinksBox({ initial }: { initial: Links }) {
  const [links, setLinks] = useState<Record<SocialKey, string>>({
    ig: initial.ig ?? "",
    threads: initial.threads ?? "",
    youtube: initial.youtube ?? "",
    facebook: initial.facebook ?? "",
  });
  const [bad, setBad] = useState<SocialKey | null>(null);
  const { busy, msg, run } = useSave();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      for (const s of SOCIALS) {
        const c = checkLink(s.key, links[s.key]);
        if (!c.ok) {
          setBad(s.key);
          return { ok: false, text: c.message };
        }
      }
      const r = await api("/api/me/profile", { method: "PATCH", body: { links } });
      if (!r.ok) {
        const f = (r.error as { field?: SocialKey }).field;
        setBad(f ?? null);
        return { ok: false, text: r.error.message };
      }
      setBad(null);
      // 顯示存進去的樣子（補上 https://）
      const next = { ...links };
      for (const s of SOCIALS) {
        const c = checkLink(s.key, links[s.key]);
        if (c.ok) next[s.key] = c.url;
      }
      setLinks(next);
      return { ok: true, text: "已儲存" };
    });
  };
  return (
    <form className="block settings-block" onSubmit={save} noValidate data-testid="links-box">
      <h2 className="block-title">社群連結</h2>
      {SOCIALS.map((s) => (
        <div key={s.key} className="link-field">
          <label className="field-label" htmlFor={`set-link-${s.key}`}>
            {s.label}
          </label>
          <input
            id={`set-link-${s.key}`}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={s.example}
            value={links[s.key]}
            disabled={busy}
            aria-invalid={bad === s.key}
            onChange={(e) => {
              setLinks({ ...links, [s.key]: e.target.value });
              if (bad === s.key) setBad(null);
            }}
            data-testid={`link-${s.key}`}
          />
        </div>
      ))}
      <div className="settings-row">
        <button type="submit" className="btn btn-line" disabled={busy} data-testid="links-save">
          {busy ? "儲存中…" : "儲存"}
        </button>
      </div>
      <SaveMsg {...msg} testid="links-msg" />
    </form>
  );
}

function FavBox({ initial }: { initial: Fav[] }) {
  const [list, setList] = useState<Fav[]>(initial);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Fav[]>([]);
  const { busy, msg, run } = useSave();
  const full = list.length >= FAV_MAX;

  useEffect(() => {
    const k = q.trim();
    if (!k) return;
    let dead = false;
    const t = setTimeout(() => {
      void api<{ artists: Fav[] }>(`/api/artists/search?visible=1&q=${encodeURIComponent(k)}`).then((r) => {
        if (!dead && r.ok) setFound(r.data.artists.slice(0, 8).map((a) => ({ slug: a.slug, name: a.name })));
      });
    }, 200);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [q]);

  const add = (a: Fav) => {
    if (full || list.some((x) => x.slug === a.slug)) return;
    setList([...list, a]);
    setQ("");
  };
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  const save = () =>
    void run(async () => {
      const r = await api("/api/me/profile", { method: "PATCH", body: { favArtists: list.map((a) => a.slug) } });
      return r.ok ? { ok: true, text: "已儲存" } : { ok: false, text: r.error.message };
    });
  const options = found.filter((a) => !list.some((x) => x.slug === a.slug));

  return (
    <section className="block settings-block" data-testid="fav-box">
      <h2 className="block-title">
        最喜歡的藝人<span className="count">{list.length} / {FAV_MAX}</span>
      </h2>
      {list.length ? (
        <ol className="fav-rows" data-testid="fav-list">
          {list.map((a, i) => (
            <li key={a.slug} className="fav-row" data-slug={a.slug}>
              <span className="fav-no num">{i + 1}</span>
              <span className="fav-name">{a.name}</span>
              <span className="fav-acts">
                <button type="button" className="fav-btn" onClick={() => swap(i, i - 1)} disabled={i === 0 || busy} aria-label={`${a.name} 往前`} data-testid="fav-up">
                  ↑
                </button>
                <button
                  type="button"
                  className="fav-btn"
                  onClick={() => swap(i, i + 1)}
                  disabled={i === list.length - 1 || busy}
                  aria-label={`${a.name} 往後`}
                  data-testid="fav-down"
                >
                  ↓
                </button>
                <button type="button" className="fav-btn fav-del" onClick={() => setList(list.filter((x) => x.slug !== a.slug))} disabled={busy} data-testid="fav-remove">
                  移除<span className="sr-only"> {a.name}</span>
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <label className="sr-only" htmlFor="set-fav-q">
        搜尋藝人
      </label>
      <input
        id="set-fav-q"
        className="input"
        placeholder={full ? `最多 ${FAV_MAX} 位，先移除再加` : "打藝人名字搜尋"}
        value={q}
        disabled={full || busy}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (options[0]) add(options[0]);
          }
        }}
        data-testid="fav-q"
      />
      {q.trim() && !full ? (
        <div className="fav-found" data-testid="fav-found">
          {options.length ? (
            options.map((a) => (
              <button key={a.slug} type="button" className="pick" onClick={() => add(a)} data-slug={a.slug}>
                {a.name}
              </button>
            ))
          ) : (
            <p className="page-meta">找不到</p>
          )}
        </div>
      ) : null}
      <div className="settings-row">
        <button type="button" className="btn btn-line" onClick={save} disabled={busy} data-testid="fav-save">
          {busy ? "儲存中…" : "儲存"}
        </button>
      </div>
      <SaveMsg {...msg} testid="fav-msg" />
    </section>
  );
}

/** 暱稱下方的三塊；資料讀到之前不畫，免得空白欄位被當成現值存回去 */
export function ProfileExtras() {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<Profile>("/api/me/profile").then((r) => (r.ok ? setP(r.data) : setErr(r.error.message)));
  }, []);
  if (err) return <p className="page-meta">{err}</p>;
  if (!p) return <div className="settings-wait" aria-hidden="true" />;
  return (
    <>
      <BioBox initial={p.bio} />
      <LinksBox initial={p.links} />
      <FavBox initial={p.favArtists} />
    </>
  );
}
