"use client";

// 後台 SEO（2026-10-01 第三層）：全站標題後綴與預設描述；藝人、系列、首頁、關於頁的自訂標題、描述、og 圖、不收錄。
// 空白欄位就用自動產生的（輸入框的提示字就是自動值）。旁邊的 Google 搜尋結果預覽照實際輸出算，超過字數會提醒。

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { CANONICAL_ORIGIN, DESC_MAX, displayWidth, fullTitle, TITLE_MAX, type SeoOverride } from "@/lib/seo";

type Form = {
  target: string;
  label: string;
  path: string;
  auto: { title: string; description: string; og: string };
  override: SeoOverride;
  absolute: boolean;
  auto_index: { index: boolean; reason: string };
  site: { suffix: string; description: string };
};
type Hit = { target: string; label: string; kind: string; path: string };
type Site = { suffix: string; description: string };

const OG_W = 1200;
const OG_H = 630;

/** 圖片置中裁成 1200×630 JPEG（品質從 .86 往下壓到 400KB 內） */
async function toOg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = OG_W;
  canvas.height = OG_H;
  const ctx = canvas.getContext("2d")!;
  const k = Math.max(OG_W / bmp.width, OG_H / bmp.height);
  const w = bmp.width * k;
  const h = bmp.height * k;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, OG_W, OG_H);
  ctx.drawImage(bmp, (OG_W - w) / 2, (OG_H - h) / 2, w, h);
  for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    const b = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (b && b.size <= 400_000) return b;
  }
  throw new Error("圖片壓不到 400KB 以內，換一張再試");
}

/** 搜尋結果裡網址那一行：lemibox.com › artist › slug */
const crumbUrl = (path: string) =>
  [CANONICAL_ORIGIN.replace(/^https:\/\//, ""), ...decodeURI(path).split("/").filter(Boolean)].join(" › ");

function Count({ text, max, label }: { text: string; max: number; label: string }) {
  const w = displayWidth(text);
  const over = w > max;
  return (
    <span className={over ? "seo-count is-over" : "seo-count"} data-testid={`seo-count-${label}`} data-over={over ? "1" : "0"}>
      {label} {Math.ceil(w)}／{max} 字{over ? "，超過了，Google 可能截斷" : ""}
    </span>
  );
}

function SerpPreview({ title, description, path }: { title: string; description: string; path: string }) {
  return (
    <div className="seo-serp" data-testid="seo-serp" aria-label="Google 搜尋結果預覽">
      <p className="seo-serp-url">{crumbUrl(path)}</p>
      <p className="seo-serp-title" data-testid="seo-serp-title">
        {title}
      </p>
      <p className="seo-serp-desc" data-testid="seo-serp-desc">
        {description}
      </p>
    </div>
  );
}

function SiteBox({ site, onSaved }: { site: Site; onSaved: () => void }) {
  const [suffix, setSuffix] = useState(site.suffix);
  const [desc, setDesc] = useState(site.description);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setMsg("");
    const r = await api<Site>("/api/admin/seo", { body: { action: "site", suffix, description: desc } });
    setBusy(false);
    if (!r.ok) return setMsg(r.error.message);
    setSuffix(r.data.suffix);
    setDesc(r.data.description);
    setMsg("已儲存");
    onSaved();
  };
  return (
    <section className="block" data-testid="seo-site">
      <h2 className="block-title">全站 SEO 設定</h2>
      <div className="seo-grid">
        <label className="seo-field">
          <span className="field-label">標題後綴</span>
          <input className="input" value={suffix} maxLength={30} onChange={(e) => setSuffix(e.target.value)} data-testid="seo-suffix" />
          <span className="sub">接在每頁標題後面，例「落日飛車｜專輯、版本與收藏｜{suffix || "樂迷藏"}」。清空＝用站名</span>
        </label>
        <label className="seo-field">
          <span className="field-label">預設描述</span>
          <textarea className="input textarea" value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} data-testid="seo-site-desc" />
          <span className="sub">首頁和沒有自己描述的頁面用這段。清空＝用內建的</span>
          <Count text={desc} max={DESC_MAX} label="描述" />
        </label>
      </div>
      <p className="seo-actions">
        <button type="button" className="btn btn-p" disabled={busy} onClick={save} data-testid="seo-site-save">
          儲存全站設定
        </button>
        {msg ? <span className="sub" role="status">{msg}</span> : null}
      </p>
    </section>
  );
}

function Editor({ target, onChanged }: { target: string; onChanged: () => void }) {
  const [f, setF] = useState<Form | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [noindex, setNoindex] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [og, setOg] = useState("");
  const apply = useCallback((r: Awaited<ReturnType<typeof api<Form>>>) => {
    if (!r.ok) return setMsg(r.error.message);
    setF(r.data);
    setTitle(r.data.override.title ?? "");
    setDesc(r.data.override.description ?? "");
    setNoindex(Boolean(r.data.override.noindex));
    setOg(r.data.override.og ? `/img/${r.data.override.og}` : r.data.auto.og);
  }, []);
  const load = useCallback(() => api<Form>(`/api/admin/seo?target=${encodeURIComponent(target)}`).then(apply), [target, apply]);
  useEffect(() => {
    void api<Form>(`/api/admin/seo?target=${encodeURIComponent(target)}`).then(apply);
  }, [target, apply]);
  if (!f) return msg ? <p className="field-error">{msg}</p> : null;
  const shownTitle = fullTitle(title.trim() || f.auto.title, f.site.suffix, f.absolute);
  const shownDesc = desc.trim() || f.auto.description;
  const save = async () => {
    setBusy(true);
    setMsg("");
    const r = await api("/api/admin/seo", { body: { action: "save", target, title, description: desc, noindex } });
    setBusy(false);
    if (!r.ok) return setMsg(r.error.message);
    setMsg("已儲存");
    onChanged();
    void load();
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      const blob = await toOg(file);
      const fd = new FormData();
      fd.set("target", target);
      fd.set("image", blob, "og.jpg");
      const r = await api<{ url: string }>("/api/admin/seo", { body: fd });
      if (!r.ok) setMsg(r.error.message);
      else {
        setMsg("og 圖已換上");
        onChanged();
        void load();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "圖片讀不進來");
    }
    setBusy(false);
  };
  const clearOg = async () => {
    setBusy(true);
    const r = await api("/api/admin/seo", { body: { action: "clear-og", target } });
    setBusy(false);
    if (!r.ok) return setMsg(r.error.message);
    setMsg("已改回自動的 og 圖");
    onChanged();
    void load();
  };
  return (
    <section className="block seo-editor" data-testid="seo-editor" data-target={target}>
      <h2 className="block-title">
        {f.label}
        <a className="link sub seo-open" href={f.path} target="_blank" rel="noopener">
          開啟頁面
        </a>
      </h2>
      <div className="seo-cols">
        <div className="seo-form">
          <label className="seo-field">
            <span className="field-label">自訂標題</span>
            <input className="input" value={title} maxLength={80} placeholder={f.auto.title} onChange={(e) => setTitle(e.target.value)} data-testid="seo-title" />
            <span className="sub">空白＝自動：{f.auto.title}{f.absolute ? "（首頁不接後綴）" : ""}</span>
            <Count text={shownTitle} max={TITLE_MAX} label="標題" />
          </label>
          <label className="seo-field">
            <span className="field-label">自訂描述</span>
            <textarea className="input textarea" value={desc} maxLength={300} placeholder={f.auto.description} onChange={(e) => setDesc(e.target.value)} data-testid="seo-desc" />
            <Count text={shownDesc} max={DESC_MAX} label="描述" />
          </label>
          <div className="seo-field">
            <span className="field-label">og 圖（分享到 FB、LINE 時的預覽圖）</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- 後台預覽 */}
            <img className="seo-og" src={og} alt="" width={300} height={158} data-testid="seo-og" />
            <span className="sub">{f.override.og ? "目前用自訂的圖" : "目前用自動挑的圖"}；上傳會置中裁成 1200×630</span>
            <span className="seo-og-acts">
              <label className="btn btn-line file-btn">
                上傳圖片
                <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} data-testid="seo-og-file" />
              </label>
              {f.override.og ? (
                <button type="button" className="btn-text" disabled={busy} onClick={clearOg} data-testid="seo-og-clear">
                  改回自動
                </button>
              ) : null}
            </span>
          </div>
          <label className="seo-check">
            <input type="checkbox" checked={noindex} onChange={(e) => setNoindex(e.target.checked)} data-testid="seo-noindex" />
            不給搜尋引擎收錄這頁
          </label>
          <p className="sub" data-testid="seo-auto-index">
            自動判斷：{f.auto_index.index ? `會收錄${f.auto_index.reason}` : `不收錄（${f.auto_index.reason}）`}
          </p>
          <p className="seo-actions">
            <button type="button" className="btn btn-p" disabled={busy} onClick={save} data-testid="seo-save">
              儲存
            </button>
            {msg ? <span className="sub" role="status" data-testid="seo-msg">{msg}</span> : null}
          </p>
        </div>
        <SerpPreview title={shownTitle} description={shownDesc} path={f.path} />
      </div>
    </section>
  );
}

export function AdminSeo({ initial }: { initial?: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [overrides, setOverrides] = useState<(SeoOverride & { target: string })[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [target, setTarget] = useState(initial ?? "page:home");
  const reload = useCallback(
    () =>
      api<{ site: Site; overrides: (SeoOverride & { target: string })[] }>("/api/admin/seo").then((r) => {
        if (r.ok) {
          setSite(r.data.site);
          setOverrides(r.data.overrides);
        }
      }),
    [],
  );
  useEffect(() => {
    void api<{ site: Site; overrides: (SeoOverride & { target: string })[] }>("/api/admin/seo").then((r) => {
      if (r.ok) {
        setSite(r.data.site);
        setOverrides(r.data.overrides);
      }
    });
  }, []);
  useEffect(() => {
    const k = q.trim();
    if (!k) return;
    const t = setTimeout(async () => {
      const r = await api<{ list: Hit[] }>(`/api/admin/seo?q=${encodeURIComponent(k)}`);
      if (r.ok) setHits(r.data.list);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const shownHits = q.trim() ? hits : [];
  const choose = (t: string) => {
    setTarget(t);
    window.history.replaceState(null, "", `/admin/seo?target=${encodeURIComponent(t)}`);
  };
  return (
    <div className="seo-admin" data-testid="admin-seo">
      {site ? <SiteBox site={site} onSaved={reload} /> : null}
      <section className="block">
        <h2 className="block-title">頁面 SEO</h2>
        <p className="sub">藝人頁、系列頁、首頁、關於頁可以各自覆寫。收藏頁一律自動產生。</p>
        <div className="seo-pick">
          <button type="button" className="btn btn-line" aria-pressed={target === "page:home"} onClick={() => choose("page:home")} data-testid="seo-pick-home">
            首頁
          </button>
          <button type="button" className="btn btn-line" aria-pressed={target === "page:about"} onClick={() => choose("page:about")} data-testid="seo-pick-about">
            關於頁
          </button>
          <input className="input" type="search" placeholder="找藝人或系列" value={q} onChange={(e) => setQ(e.target.value)} data-testid="seo-search" aria-label="找藝人或系列" />
        </div>
        {shownHits.length ? (
          <ul className="seo-hits" data-testid="seo-hits">
            {shownHits.map((h) => (
              <li key={h.target}>
                <button type="button" className="btn-text" onClick={() => choose(h.target)} data-target={h.target}>
                  {h.label}
                </button>
                <span className="sub">{h.kind}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {overrides.length ? (
          <p className="sub seo-overridden" data-testid="seo-overridden">
            有覆寫過：
            {overrides.map((o, i) => (
              <span key={o.target}>
                {i ? "、" : ""}
                <button type="button" className="btn-text" onClick={() => choose(o.target)}>
                  {o.target}
                </button>
                {o.noindex ? "（不收錄）" : ""}
              </span>
            ))}
          </p>
        ) : null}
      </section>
      <Editor key={target} target={target} onChanged={reload} />
    </div>
  );
}
