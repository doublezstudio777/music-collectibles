"use client";

// 全家福合集的發文與編輯（2026-10-01 一次發多張）。
// 照片（一張或幾張大合照，跟炫收藏同一套上傳：瀏覽器燒浮水印、查證碼、每日上限）→ 標記裡面有哪些專輯（可以跨藝人）
// → 想說的話 → 發布。標記先列清單；要在照片上標位置，按那一列的「標在照片上」再點照片（手機一樣是點一下）。
// 合集純展示：沒有出售狀態。

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/link";
import { api, useAccount, whenLoggedIn } from "@/lib/account";
import { uploadCoverOg } from "@/lib/image";
import { collectionWhat, norm, PHOTO_LICENSE_URL, shareHref, SITE_NAME, type Kind } from "@/lib/data";
import type { PickSeries } from "@/lib/catalog";
import { PhotoPicker, usePhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import { AddSeries, PickList, submitSeries, submitVersion, type NewSeries } from "@/components/pick-list";
import { CollectionPhoto, type Pin } from "@/components/collection-photo";
import { track } from "@/lib/analytics";

/** 一個標記：key＝系列鍵／品項鍵／版本鍵；photo＝照片在表單裡的 key（上傳中也有）；x、y 是 0～1 */
type Tag = { key: string; label: string; artist: string; photo?: string; x?: number; y?: number };
type FoundArtist = { slug: string; name: string };

export type CollectionEdit = {
  n: number;
  story: string;
  customTitle: string;
  tags: { key: string; label: string; artist: string; photo?: string; x?: number; y?: number }[];
};

export function CollectionForm({ edit, preset }: { edit?: CollectionEdit; preset?: FoundArtist | null }) {
  const [initial, setInitial] = useState<PickedPhoto[] | null>(edit ? null : []);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!edit) return;
    void api<{ photos: { id: string; url: string; thumbUrl: string }[] }>(`/api/shares/${edit.n}/photos`).then((r) => {
      if (!r.ok) return setLoadError(r.error.message);
      // 編輯時照片的 key 就用伺服器的照片 id，標記上的 photo 直接對得上
      setInitial(r.data.photos.map((p) => ({ key: p.id, id: p.id, preview: p.url, url: p.url, status: "done", attached: true })));
    });
  }, [edit]);
  if (loadError) return <p className="field-error">{loadError}</p>;
  if (!initial) return <p role="status">讀取中</p>;
  return <Body edit={edit} initial={initial} preset={preset ?? null} />;
}

function Body({ edit, initial, preset }: { edit?: CollectionEdit; initial: PickedPhoto[]; preset: FoundArtist | null }) {
  const router = useRouter();
  const acc = useAccount();
  const [paused, setPaused] = useState(false);
  const picker = usePhotoPicker(initial, () => setPaused(true), acc.me?.handle ?? "");
  useEffect(() => {
    void api<{ paused: boolean }>("/api/uploads").then((r) => r.ok && setPaused(r.data.paused));
  }, []);

  /* ---------- 標記 ---------- */
  const [tags, setTags] = useState<Tag[]>(edit?.tags ?? []);
  const [placing, setPlacing] = useState<string | null>(null);

  /* ---------- 找藝人、列專輯 ---------- */
  const [artists, setArtists] = useState<FoundArtist[]>(preset ? [preset] : []);
  const [current, setCurrent] = useState<string | null>(preset?.slug ?? null);
  const [lists, setLists] = useState<Record<string, PickSeries[]>>({});
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FoundArtist[]>([]);
  const [listError, setListError] = useState("");

  useEffect(() => {
    const term = norm(q);
    if (!term) return;
    const t = window.setTimeout(() => {
      void api<{ artists: FoundArtist[] }>(`/api/artists/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.ok && setHits(r.data.artists.slice(0, 8)));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!current || lists[current]) return;
    void api<{ series: PickSeries[] }>(`/api/catalog/artist-series?artist=${encodeURIComponent(current)}`).then((r) => {
      if (r.ok) {
        setLists((m) => ({ ...m, [current]: r.data.series }));
        setListError("");
      } else setListError(r.error.message);
    });
  }, [current, lists]);

  const chooseArtist = (a: FoundArtist) => {
    setArtists((xs) => (xs.some((x) => x.slug === a.slug) ? xs : [...xs, a]));
    setCurrent(a.slug);
    setQ("");
    setHits([]);
  };

  const curArtist = artists.find((a) => a.slug === current) ?? null;
  const curList = current ? lists[current] : undefined;
  const tagged = useMemo(() => new Set(tags.map((t) => t.key)), [tags]);

  const toggleTag = (key: string, label: string) => {
    if (tagged.has(key)) {
      setTags((xs) => xs.filter((t) => t.key !== key));
      if (placing === key) setPlacing(null);
      return;
    }
    const w = curList?.find((x) => x.key === key.split("#")[0]);
    const artist = w?.artist ?? curArtist?.name ?? "";
    setTags((xs) => [...xs, { key, label: `${artist}《${w?.title ?? ""}》${label}`, artist }]);
  };

  const addSeries = async (f: NewSeries) => {
    if (!curArtist) return "先選藝人";
    const w = await submitSeries(curArtist, f);
    if (typeof w === "string") return w;
    setLists((m) => ({ ...m, [curArtist.slug]: [w, ...(m[curArtist.slug] ?? [])] }));
    toggleTagFrom(w, w.key, "不確定版本");
    return null;
  };
  const addVersion = async (seriesKey: string, f: { kind: Kind; edition: string; year: string }) => {
    if (!curArtist || !curList) return "先選藝人";
    const r = await submitVersion(curList, seriesKey, f);
    if (typeof r === "string") return r;
    setLists((m) => ({ ...m, [curArtist.slug]: r.series }));
    const w = r.series.find((x) => x.key === seriesKey)!;
    const v = w.items.flatMap((it) => it.versions).find((x) => x.key === r.key)!;
    toggleTagFrom(w, r.key, v.label);
    return null;
  };
  const toggleTagFrom = (w: PickSeries, key: string, label: string) =>
    setTags((xs) => (xs.some((t) => t.key === key) ? xs : [...xs, { key, label: `${w.artist}《${w.title}》${label}`, artist: w.artist }]));

  /* ---------- 照片上的位置 ---------- */
  const doneKeys = picker.items.map((x) => x.key);
  const pinsOf = (photoKey: string): Pin[] =>
    tags.flatMap((t, i) => (t.photo === photoKey && t.x !== undefined && t.y !== undefined ? [{ n: i + 1, x: t.x, y: t.y, key: t.key }] : []));
  const place = (photoKey: string, x: number, y: number) => {
    if (!placing) return;
    setTags((xs) => xs.map((t) => (t.key === placing ? { ...t, photo: photoKey, x, y } : t)));
    setPlacing(null);
  };
  const startPlacing = (key: string) => {
    setPlacing(key);
    document.getElementById("cf-photos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const clearPin = (key: string) => setTags((xs) => xs.map((t) => (t.key === key ? { key: t.key, label: t.label, artist: t.artist } : t)));
  const move = (i: number, d: number) =>
    setTags((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /* ---------- 文字 ---------- */
  const [story, setStory] = useState(edit?.story ?? "");
  const [customTitle, setCustomTitle] = useState(edit?.customTitle ?? "");
  const artistNames = Array.from(new Set(tags.flatMap((t) => t.artist.split("、")).filter(Boolean)));
  const autoTitle = tags.length ? collectionWhat(artistNames, tags.length) : "";

  /* ---------- 送出 ---------- */
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [formError, setFormError] = useState("");
  const errors: Record<string, string> = {};
  if (!picker.items.length) errors.photo = "放一張合集照片";
  else if (picker.pending) errors.photo = "照片還在上傳，等一下";
  else if (picker.failed) errors.photo = "有照片沒傳上去，按重試或刪掉那張";
  if (!tags.length) errors.tags = "至少標一張專輯";
  const missing = [...(errors.photo ? ["照片"] : []), ...(errors.tags ? ["標記專輯"] : [])];

  const body = () => {
    const idOf = new Map(picker.items.map((x) => [x.key, x.id]));
    return {
      story: story.trim(),
      customTitle: customTitle.trim(),
      tags: tags.map((t) => {
        const pid = t.photo ? idOf.get(t.photo) : undefined;
        return pid && t.x !== undefined && t.y !== undefined ? { key: t.key, photo: pid, x: t.x, y: t.y } : { key: t.key };
      }),
    };
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTried(true);
    setFormError("");
    if (Object.keys(errors).length) return;
    if (edit) {
      setBusy(true);
      const ids = picker.items.map((x) => x.id);
      if (ids.join(",") !== initial.map((x) => x.id).join(",")) {
        const r = await api<{ needOg: boolean }>(`/api/shares/${edit.n}/photos`, { method: "PUT", body: { photoIds: ids } });
        if (!r.ok) {
          setBusy(false);
          return setFormError(r.error.message);
        }
        const cover = picker.items[0];
        if (r.data.needOg && cover?.id) await uploadCoverOg(cover.id, cover.file ?? cover.url ?? "", acc.me?.handle ?? "", cover.code).catch(() => null);
      }
      const r = await api(`/api/collections/${edit.n}`, { method: "PUT", body: body() });
      if (!r.ok) {
        setBusy(false);
        return setFormError(r.error.message);
      }
      router.push(shareHref(edit.n));
      router.refresh();
      return;
    }
    whenLoggedIn("登入後才能發合集", async () => {
      setBusy(true);
      const cover = picker.items[0];
      if (cover?.id && acc.me?.handle) await uploadCoverOg(cover.id, cover.file ?? cover.url ?? "", acc.me.handle, cover.code).catch(() => null);
      const r = await api<{ n: number }>("/api/collections", { body: { photoIds: picker.items.map((x) => x.id).filter(Boolean), ...body() } });
      if (!r.ok) {
        setBusy(false);
        return setFormError(r.error.message);
      }
      track("share_publish", { kind: "合集" });
      router.push(shareHref(r.data.n));
    });
  };

  const placingTag = placing ? tags.findIndex((t) => t.key === placing) : -1;

  return (
    <form className="sf cf" onSubmit={submit} noValidate data-testid={edit ? "collection-edit-form" : "collection-form"}>
      <div className="sf-main cf-main">
        <div className="field" id="cf-photos">
          <span className="field-label" id="cf-photo-label">
            合集照片
          </span>
          <div
            onClickCapture={(e) => {
              if (!acc.me && (e.target as HTMLElement).closest("label.drop")) {
                e.preventDefault();
                whenLoggedIn("登入後才能發合集", () => undefined);
              }
            }}
          >
            <PhotoPicker picker={picker} labelId="cf-photo-label" paused={paused} disabled={busy} />
          </div>
          {tried && errors.photo ? <p className="field-error">{errors.photo}</p> : null}
          {placing ? (
            <p className="cf-placing" role="status" data-testid="cf-placing">
              點照片上 <b className="num">{placingTag + 1}</b> 號的位置
              <button type="button" className="btn-text" onClick={() => setPlacing(null)}>
                取消
              </button>
            </p>
          ) : null}
          {picker.items.some((x) => x.status === "done") ? (
            <div className="cf-stage" data-testid="cf-stage">
              {picker.items.map((it, i) =>
                it.status === "done" ? (
                  <div key={it.key} className="cf-stage-photo">
                    <CollectionPhoto
                      src={it.preview}
                      w={0}
                      h={0}
                      alt={`第 ${i + 1} 張合集照片`}
                      pins={pinsOf(it.key)}
                      active={placing}
                      placing={Boolean(placing)}
                      onPlace={(x, y) => place(it.key, x, y)}
                      onPin={(k) => setPlacing(k)}
                    />
                  </div>
                ) : null,
              )}
            </div>
          ) : null}
        </div>

        <div className="field" id="cf-tags">
          <span className="field-label">標記裡面有哪些專輯</span>
          {tags.length ? (
            <ol className="cf-tags" data-testid="cf-tags">
              {tags.map((t, i) => (
                <li key={t.key} className={placing === t.key ? "cf-tag is-on" : "cf-tag"} data-key={t.key} data-testid="cf-tag">
                  <span className={t.photo && doneKeys.includes(t.photo) ? "ctag-n is-pinned" : "ctag-n"}>{i + 1}</span>
                  <span className="cf-tag-label">{t.label}</span>
                  <span className="cf-tag-acts">
                    {picker.items.some((x) => x.status === "done") ? (
                      <button type="button" className="btn-text" onClick={() => startPlacing(t.key)} data-testid="cf-tag-place">
                        {t.photo ? "改位置" : "標在照片上"}
                      </button>
                    ) : null}
                    {t.photo ? (
                      <button type="button" className="btn-text" onClick={() => clearPin(t.key)} data-testid="cf-tag-unpin">
                        拿掉位置
                      </button>
                    ) : null}
                    <button type="button" className="cf-mini" aria-label={`${i + 1} 號往上`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="cf-mini" aria-label={`${i + 1} 號往下`} disabled={i === tags.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="cf-mini" aria-label={`拿掉 ${i + 1} 號`} onClick={() => toggleTag(t.key, "")} data-testid="cf-tag-remove">
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {tried && errors.tags ? <p className="field-error">{errors.tags}</p> : null}

          <div className="cf-artists">
            {artists.length ? (
              <div className="picks" role="group" aria-label="藝人" data-testid="cf-artist-tabs">
                {artists.map((a) => (
                  <button key={a.slug} type="button" className="pick" aria-pressed={current === a.slug} onClick={() => setCurrent(a.slug)} data-slug={a.slug}>
                    {a.name}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              className="input cf-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={artists.length ? "再加一位藝人" : "誰的專輯？打名字找"}
              aria-label="找藝人"
              data-testid="cf-artist-search"
            />
            {q.trim() && hits.length ? (
              <div className="sf-list" data-testid="cf-artist-hits">
                {hits.map((a) => (
                  <button key={a.slug} type="button" className="sf-row" onClick={() => chooseArtist(a)} data-slug={a.slug} data-testid="cf-artist-hit">
                    <span className="sf-row-name">{a.name}</span>
                  </button>
                ))}
              </div>
            ) : q.trim() && norm(q) ? (
              <p className="sub cf-nohit">找不到</p>
            ) : null}
          </div>
          {listError ? <p className="field-error">{listError}</p> : null}
          {curArtist && curList ? (
            <div className="cf-list">
              <AddSeries onSave={addSeries} />
              <PickList series={curList} isOn={(k) => tagged.has(k)} onToggle={toggleTag} onAddVersion={addVersion} testid="cf-pick-list" />
            </div>
          ) : curArtist ? (
            <p role="status">讀取中</p>
          ) : null}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="cf-story">
            想說的話 <span className="sub-inline">選填</span>
          </label>
          <textarea id="cf-story" className="input textarea" rows={4} maxLength={2000} value={story} onChange={(e) => setStory(e.target.value)} data-testid="cf-story" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cf-title">
            標題 <span className="sub-inline">選填</span>
          </label>
          <input id="cf-title" className="input" maxLength={80} value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder={autoTitle || "標記完會自動組好"} data-testid="cf-title" />
        </div>
      </div>

      <aside className="sf-summary cf-summary" aria-label="發布">
        <span className="sf-sum-text">
          <b className={customTitle || autoTitle ? "sf-sum-title" : "sf-sum-title is-empty"} data-testid="cf-sum-title">
            {customTitle.trim() || autoTitle || "標題會照標記的專輯自動組好"}
          </b>
          <span className="sf-sum-missing">{missing.length ? `還差：${missing.join("、")}` : edit ? "" : "可以發布了"}</span>
        </span>
        <span className="sf-license" data-testid="cf-license">
          {edit ? "儲存" : "發布"}即表示這些照片是你本人拍攝，並同意以{" "}
          <a className="link" href={PHOTO_LICENSE_URL} target="_blank" rel="license noopener">
            CC BY-NC-ND 4.0
          </a>{" "}
          授權他人非商業分享（須標示你與{SITE_NAME}、不得修改）。這項授權發布後無法撤回。詳見
          <a className="link" href="/terms#t7" target="_blank" rel="noopener">
            使用條款
          </a>
          。
        </span>
        {formError ? (
          <p className="field-error" role="alert" data-testid="cf-error">
            {formError}
          </p>
        ) : null}
        <span className="sf-sum-acts">
          <button type="submit" className="btn btn-p" disabled={busy || picker.pending > 0} data-testid="cf-submit">
            {busy ? (edit ? "儲存中…" : "發布中…") : edit ? "儲存" : "發布"}
          </button>
          {edit ? (
            <Link className="btn-text sf-cancel" href={shareHref(edit.n)}>
              取消
            </Link>
          ) : null}
        </span>
      </aside>
    </form>
  );
}
