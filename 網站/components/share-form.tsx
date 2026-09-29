"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  composeWhat,
  isRecordKind,
  itemInVersion,
  KINDS,
  MISC_SERIES_TITLE,
  miscSeriesRef,
  norm,
  SERIES_KIND_LABEL,
  type Kind,
  type SaleState,
} from "@/lib/data";
import type { FormOptions } from "@/lib/catalog";
import { api, useAccount, whenLoggedIn } from "@/lib/account";
import { uploadCoverOg } from "@/lib/image";
import { PhotoPicker, usePhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import { MoneyInput, parsePrice } from "@/components/share-detail";

// 炫收藏表單（2026-09-28 上傳表單改版，照 產出/20260928_上傳表單UX/）：
// 單頁；照片在最上面；「這是什麼」一組（誰的東西？是什麼？哪一張專輯／哪裡出的？哪個版本？），答完收成「值＋改」；
// 「想多說一點」一組都可以不填；發布列手機黏在底部、桌機是右欄預覽卡（同一個節點，CSS 換位置）。
// 錯誤訊息是依目前的答案即時算的：按過一次發布才顯示，答好的那一刻就消失。
// 新增藝人、專輯、演唱會是事後審：新增完立刻選好，自己新增的永遠可以改名。

function splitTags(s: string) {
  return s
    .split(/[,，、\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

type FormArtist = FormOptions["defaultArtists"][number];
type FormSeries = FormOptions["series"][number];
export type Mine = { artists: string[]; series: string[]; versions?: string[] };
/** 版本選項：品項＋版本（同一張專輯可能有兩個同類品項，版本清單攤平在一起） */
type VOpt = { itemId: string; id: string; edition: string; year: string; region: string; key: string };

/** 版本的口語名稱：「2019 台灣 一般版 CD」「日版 CD」；年份、地區、品項已在名稱裡就不重複 */
export function versionLabel(v: Pick<VOpt, "edition" | "year" | "region">, item: string) {
  const e = v.edition.trim();
  const head = [v.year && !e.includes(v.year) ? v.year : "", v.region && !e.includes(v.region) ? v.region : "", e].filter(Boolean).join(" ");
  return item && !itemInVersion(item, head) ? `${head} ${item}` : head;
}

const MEASURE: Partial<Record<Kind, string>> = { 毛巾: "條", "T 恤": "件", 海報: "張", 場刊: "本" };
const ROWS = 6;

/** 編輯已發布的炫收藏：同一張表單，照片也在裡面 */
export type ShareEdit = {
  n: number;
  about: string[];
  seriesKey?: string;
  itemId?: string;
  versionId?: string;
  kind: Kind;
  kindNote: string;
  story: string;
  tags: string[];
  sale: { state: SaleState; price?: number };
  /** 發文者自訂的標題；空字串＝用自動標題 */
  customTitle: string;
  /** 這則「跟誰有關」對得到的藝人（不在預設清單裡也要能拼出系列選項） */
  artists: FormArtist[];
  /** 舊制（事前審）還在等審核的系列：這則先掛「不確定」 */
  pendingSeries?: { id: number; title: string } | null;
};

/** 答完的題目：一條黑框，名稱＋小字，右邊「修改」或「改名」按鈕（有框、手機至少 44px 高） */
function Answer({
  testid,
  title,
  sub,
  isNew,
  action,
  onAction,
}: {
  testid: string;
  title: string;
  sub?: string;
  isNew?: boolean;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="sf-answer" data-testid={testid} onClick={onAction}>
      <span className="sf-answer-text">
        <b>
          {title}
          {isNew ? <span className="sf-new">新增</span> : null}
        </b>
        {sub ? <span className="sf-answer-sub">{sub}</span> : null}
      </span>
      <button
        type="button"
        className="sf-change"
        data-testid={`${testid}-change`}
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
      >
        {action}
      </button>
    </div>
  );
}

/** 就地新增、改名共用的虛線框：名稱（＋年份）；年份可以勾「不記得」 */
function NameBox({
  testid,
  heading,
  initialName,
  initialYear,
  withYear,
  saveLabel,
  onSave,
  onCancel,
  cancelLabel,
  noYearAtStart,
}: {
  noYearAtStart?: boolean;
  testid: string;
  heading: string;
  initialName: string;
  initialYear?: string;
  withYear: boolean;
  saveLabel: string;
  onSave: (name: string, year: string) => Promise<string | null>;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const [name, setName] = useState(initialName);
  const [year, setYear] = useState(initialYear ?? "");
  const [noYear, setNoYear] = useState(Boolean(noYearAtStart));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return setError("填名字");
    if (withYear && !noYear && year.trim() && !/^\d{4}$/.test(year.trim())) return setError("年份填西元四位數，或選「不記得」");
    setBusy(true);
    const err = await onSave(name.trim(), withYear && !noYear ? year.trim() : "");
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <div className="sf-box" data-testid={testid}>
      <b className="sf-box-title">{heading}</b>
      <div className={withYear ? "sf-box-row" : "sf-box-row one"}>
        <input
          className="input"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          aria-label="名稱"
          data-testid={`${testid}-name`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
        {withYear ? (
          <input
            className="input"
            inputMode="numeric"
            maxLength={4}
            placeholder="年份"
            value={noYear ? "" : year}
            disabled={noYear}
            onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, ""))}
            aria-label="年份"
            data-testid={`${testid}-year`}
          />
        ) : null}
      </div>
      {withYear ? (
        <label className="check-inline sf-noyear">
          <input type="checkbox" checked={noYear} onChange={(e) => setNoYear(e.target.checked)} data-testid={`${testid}-noyear`} />
          不記得年份
        </label>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
      <span className="sf-box-acts">
        <button type="button" className="btn btn-line" onClick={save} disabled={busy} data-testid={`${testid}-save`}>
          {busy ? "處理中…" : saveLabel}
        </button>
        <button type="button" className="btn-text" onClick={onCancel} data-testid={`${testid}-cancel`}>
          {cancelLabel}
        </button>
      </span>
    </div>
  );
}

/** 新增版本的虛線框：版本名稱必填，年份、地區選填；新增後立即可用（事後審），自己新增的永遠可以改名 */
function NewVersionBox({ onSave, onCancel }: { onSave: (f: { edition: string; year: string; region: string }) => Promise<string | null>; onCancel: () => void }) {
  const [f, setF] = useState({ edition: "", year: "", region: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.edition.trim()) return setError("填版本名稱");
    if (f.year.trim() && !/^\d{4}$/.test(f.year.trim())) return setError("年份填西元四位數，不知道就空著");
    setBusy(true);
    const err = await onSave({ edition: f.edition.trim(), year: f.year.trim(), region: f.region.trim() });
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <div className="sf-box" data-testid="new-version">
      <b className="sf-box-title">新增版本</b>
      <input
        className="input"
        maxLength={40}
        placeholder="例：日版、首批限定、再版、簽名版"
        value={f.edition}
        onChange={(e) => setF({ ...f, edition: e.target.value })}
        aria-label="版本名稱"
        data-testid="new-version-name"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="sf-box-row sf-box-row-half">
        <input className="input" inputMode="numeric" maxLength={4} placeholder="年份（選填）" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/[^\d]/g, "") })} aria-label="年份" data-testid="new-version-year" />
        <input className="input" maxLength={20} placeholder="地區（選填）" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} aria-label="地區" data-testid="new-version-region" />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <span className="sf-box-acts">
        <button type="button" className="btn btn-line" onClick={save} disabled={busy} data-testid="new-version-save">
          {busy ? "處理中…" : "新增並選用"}
        </button>
        <button type="button" className="btn-text" onClick={onCancel} data-testid="new-version-cancel">
          取消
        </button>
      </span>
    </div>
  );
}

export function ShareForm({ options, edit, mine }: { options: FormOptions; edit?: ShareEdit; mine?: Mine }) {
  const [initial, setInitial] = useState<PickedPhoto[] | null>(edit ? null : []);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!edit) return;
    void api<{ photos: { id: string; url: string; thumbUrl: string }[] }>(`/api/shares/${edit.n}/photos`).then((r) => {
      if (!r.ok) return setLoadError(r.error.message);
      setInitial(r.data.photos.map((p) => ({ key: p.id, id: p.id, preview: p.thumbUrl, url: p.url, status: "done", attached: true })));
    });
  }, [edit]);
  if (loadError) return <p className="field-error">{loadError}</p>;
  if (!initial) return <p role="status">讀取中</p>;
  return <FormBody options={options} edit={edit} mine={mine} initial={initial} />;
}

function FormBody({ options, edit, mine, initial }: { options: FormOptions; edit?: ShareEdit; mine?: Mine; initial: PickedPhoto[] }) {
  const router = useRouter();
  const acc = useAccount();
  const id = "share-form";
  const [paused, setPaused] = useState(false);
  const picker = usePhotoPicker(initial, () => setPaused(true), acc.me?.handle ?? "");

  /* ---------- 誰的東西 ---------- */
  const [about, setAbout] = useState<string[]>(edit?.about ?? []);
  const [aboutOpen, setAboutOpen] = useState(!edit?.about.length);
  const [aboutDraft, setAboutDraft] = useState("");
  const [found, setFound] = useState<FormArtist[]>(edit?.artists ?? []);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [myArtists, setMyArtists] = useState<string[]>(mine?.artists ?? []);
  const [renameArtist, setRenameArtist] = useState<string | null>(null);

  /* ---------- 是什麼 ---------- */
  const [kind, setKind] = useState<Kind | null>(edit?.kind ?? null);
  const [kindOpen, setKindOpen] = useState(!edit);
  const [kindNote, setKindNote] = useState(edit?.kindNote ?? "");

  /* ---------- 哪一張／哪裡出的 ---------- */
  /** 系列鍵、「misc:{藝人}」、"unsure"；null＝還沒答（送出時當不確定） */
  const [where, setWhere] = useState<string | null>(edit ? (edit.seriesKey ?? "unsure") : null);
  // 單則頁「補上是哪一張」連過來（#share-form-sec-where）直接打開那一題；編輯表單只在瀏覽器掛載（先讀照片），讀 location 不會 hydration 不一致
  const [whereOpen, setWhereOpen] = useState(() => Boolean(edit) && typeof location !== "undefined" && location.hash === "#share-form-sec-where");
  const [whereQ, setWhereQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [newBox, setNewBox] = useState<null | { kind: "album" | "tour"; name: string }>(null);
  const [renameSeries, setRenameSeries] = useState(false);
  const [extraSeries, setExtraSeries] = useState<FormSeries[]>([]);
  /** 自己新增的系列改名後的新名稱（覆蓋載入時的清單） */
  const [seriesPatch, setSeriesPatch] = useState<Record<string, Pick<FormSeries, "title" | "year" | "name">>>({});
  const [mySeries, setMySeries] = useState<string[]>(mine?.series ?? []);
  const [pendingSeries, setPendingSeries] = useState(edit?.pendingSeries ?? null);
  const [itemPick, setItemPick] = useState<string | null>(edit?.itemId ?? null);
  const [versionPick, setVersionPick] = useState<string>(edit?.versionId ?? "unsure");
  /** 版本題：選好專輯後直接攤開；答過（含「不確定」）才收成一列 */
  const [versionOpen, setVersionOpen] = useState(!edit?.versionId);
  const [newVersion, setNewVersion] = useState(false);
  const [renameVersion, setRenameVersion] = useState(false);
  /** 這次在表單裡新增的版本（載入時的清單裡還沒有）；改名後的新名稱 */
  const [extraVersions, setExtraVersions] = useState<(VOpt & { seriesKey: string; kind: string })[]>([]);
  const [versionPatch, setVersionPatch] = useState<Record<string, Pick<VOpt, "edition" | "year" | "region">>>({});
  const [myVersions, setMyVersions] = useState<string[]>(mine?.versions ?? []);

  /* ---------- 想多說一點 ---------- */
  const [story, setStory] = useState(edit?.story ?? "");
  const [tags, setTags] = useState(edit?.tags.join("、") ?? "");
  const [customTitle, setCustomTitle] = useState(edit?.customTitle ?? "");
  const [titleOpen, setTitleOpen] = useState(false);
  const initialSale: SaleState = edit?.sale.state ?? "share";
  const sold = initialSale === "sold";
  const [saleState, setSaleState] = useState<SaleState>(sold ? "sale" : initialSale);
  const [price, setPrice] = useState(edit?.sale.price ? String(edit.sale.price) : "");

  const [tried, setTried] = useState(false);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (edit) return;
    void api<{ paused: boolean }>("/api/uploads").then((r) => r.ok && setPaused(r.data.paused));
  }, [edit]);
  // 單則頁「補上是哪一張」連過來：直接打開那一題
  useEffect(() => {
    if (location.hash !== `#${id}-sec-where`) return;
    requestAnimationFrame(() => document.getElementById(`${id}-sec-where`)?.scrollIntoView({ block: "center" }));
  }, []);

  const known = [...options.defaultArtists, ...options.moreArtists, ...found];
  const resolveArtist = (t: string): FormArtist | undefined => {
    const q = norm(t);
    return known.find((a) => norm(a.name) === q || a.aliases.some((x) => norm(x) === q));
  };

  // 打字搜尋：debounce 300ms 查全部藝人（含別名）
  useEffect(() => {
    const draft = aboutDraft.trim();
    if (!draft) return;
    const t = setTimeout(() => {
      void api<{ artists: FormArtist[] }>(`/api/artists/search?q=${encodeURIComponent(draft)}`).then((r) => {
        if (r.ok)
          setFound((prev) => {
            const seen = new Set(prev.map((a) => a.slug));
            return [...prev, ...r.data.artists.filter((a) => !seen.has(a.slug))];
          });
        setSearchedQuery(draft.toLowerCase());
      });
    }, 300);
    return () => clearTimeout(t);
  }, [aboutDraft]);
  const q = aboutDraft.trim().toLowerCase();
  // 建議最多 5 個：完全相同 → 開頭相同 → 包含（found 是歷次搜尋累積的，順序不代表相關程度；2026-09-28 修：
  // 同字首的藝人超過 5 位時，打出完整名字的那位原本可能被擠出清單、選不到）
  const sugRank = (a: FormArtist) =>
    Math.min(...[a.name, ...a.aliases].map((x) => x.toLowerCase()).map((n) => (n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3)));
  const suggestions = q
    ? found
        .filter((a) => !about.includes(a.name) && sugRank(a) < 3)
        .map((a, i) => ({ a, r: sugRank(a), i }))
        .sort((x, y) => x.r - y.r || x.i - y.i)
        .map((x) => x.a)
        .slice(0, 5)
    : [];
  const settled = searchedQuery === q;
  const exact = q ? resolveArtist(aboutDraft) : undefined;

  /** 換了藝人：已選的專輯／出處不屬於現在任何一位就清掉（下游只在對不上時清空） */
  const setArtists = (names: string[], extra?: FormArtist) => {
    setAbout(names);
    const slugs = names.map((n) => (extra && extra.name === n ? extra : resolveArtist(n))?.slug).filter(Boolean) as string[];
    if (!where || where === "unsure") return;
    const owner = where.startsWith("misc:") ? [where.slice(5)] : ([...options.series, ...extraSeries].find((w) => w.key === where)?.credits ?? []);
    if (!owner.some((x) => slugs.includes(x))) {
      setWhere(null);
      setItemPick(null);
      setVersionPick("unsure");
    }
  };
  const pickArtist = (a: FormArtist) => {
    setFound((prev) => (prev.some((x) => x.slug === a.slug) ? prev : [...prev, a]));
    setArtists(about.includes(a.name) ? about : [...about, a.name], a);
    setAboutDraft("");
    setAboutOpen(false);
  };
  const createArtist = (name: string) =>
    whenLoggedIn("登入後才能新增", async () => {
      const r = await api<{ key: string; existing?: boolean; artist: FormArtist }>("/api/catalog/submit", { body: { type: "artist", name } });
      if (!r.ok) return setFormError(r.error.message);
      if (!r.data.existing) setMyArtists((xs) => [...xs, r.data.artist.slug]);
      pickArtist(r.data.artist);
    });

  /* ---------- 系列選項 ---------- */
  const pickedArtists = about.map((n) => resolveArtist(n)).filter((a): a is FormArtist => Boolean(a));
  const allSeries = [...options.series, ...extraSeries].map((w) => (seriesPatch[w.key] ? { ...w, ...seriesPatch[w.key] } : w));
  const seriesOptions: FormSeries[] = [];
  pickedArtists.forEach((a) =>
    allSeries.filter((w) => w.credits.includes(a.slug)).forEach((w) => !seriesOptions.some((x) => x.key === w.key) && seriesOptions.push(w)),
  );
  const current = where && !seriesOptions.some((w) => w.key === where) ? allSeries.find((w) => w.key === where) : undefined;
  if (current) seriesOptions.push(current);
  const newest = (x: FormSeries, y: FormSeries) => (Number(y.year.slice(0, 4)) || 0) - (Number(x.year.slice(0, 4)) || 0);
  const ofKinds = (...ks: string[]) => seriesOptions.filter((w) => ks.includes(w.kind)).sort(newest);
  const miscOptions = pickedArtists.map((a) => {
    const w = allSeries.find((x) => x.kind === "misc" && x.credits[0] === a.slug);
    return { key: w?.key ?? miscSeriesRef(a.slug), title: pickedArtists.length > 1 ? `${MISC_SERIES_TITLE}（${a.name}）` : MISC_SERIES_TITLE, series: w };
  });
  const record = kind ? isRecordKind(kind) : false;
  const series = where ? (seriesOptions.find((w) => w.key === where) ?? miscOptions.find((m) => m.key === where)?.series) : undefined;
  const misc = where ? miscOptions.find((m) => m.key === where) : undefined;
  const sameKind = series && kind ? series.items.filter((i) => i.kind === kind) : [];
  const vOpts: VOpt[] = [];
  if (series && kind) {
    for (const v of [
      ...sameKind.flatMap((it) => it.versions.map((x) => ({ ...x, itemId: it.id }))),
      ...extraVersions.filter((x) => x.seriesKey === series.key && x.kind === kind),
    ])
      if (!vOpts.some((o) => o.key === v.key)) vOpts.push({ itemId: v.itemId, id: v.id, key: v.key, ...(versionPatch[v.key] ?? { edition: v.edition, year: v.year, region: v.region }) });
  }
  const version = vOpts.find((v) => v.itemId === itemPick && v.id === versionPick);
  /** 送出用的品項：選了版本就是版本所屬的品項；沒選版本、系列裡只有一個同類品項就用它 */
  const item = version ? { id: version.itemId } : sameKind.length === 1 ? sameKind[0] : sameKind.find((i) => i.id === itemPick);
  const whereValid = where === "unsure" || Boolean(series) || Boolean(misc);
  const kindLabel = kind === "其他周邊" ? kindNote.trim() || kind : (kind ?? "");
  const whereQuestion = !kind || record ? "哪一張專輯？" : kind === "其他周邊" ? "這個周邊是哪裡出的？" : `這${MEASURE[kind] ?? "個"}${kind}是哪裡出的？`;
  const whereShort = !kind || record ? "哪一張專輯" : "哪裡出的";
  const ready = pickedArtists.length > 0 && Boolean(kind);

  const pickKind = (k: Kind) => {
    // 下游只在對不上時清空：CD→黑膠專輯保留；唱片→周邊時專輯仍是合法選項（專輯的周邊），也保留
    const s = where ? allSeries.find((w) => w.key === where) : undefined;
    if (where?.startsWith("misc:") && isRecordKind(k)) setWhere(null);
    if (s && (s.kind === "tour" || s.kind === "brand" || s.kind === "misc") && isRecordKind(k)) setWhere(null);
    setKind(k);
    setKindOpen(false);
    setItemPick(null);
    setVersionPick("unsure");
    setVersionOpen(true);
    setNewVersion(false);
  };
  const pickWhere = (k: string) => {
    setWhere(k);
    setWhereOpen(false);
    setWhereQ("");
    setNewBox(null);
    setItemPick(null);
    setVersionPick("unsure");
    setVersionOpen(true);
    setNewVersion(false);
    setRenameVersion(false);
    if (k !== "unsure") setPendingSeries(null);
  };
  const createSeries = async (sk: "album" | "tour", name: string, year: string) => {
    const owner = pickedArtists[0];
    if (!owner) return "先選誰的東西";
    // 新增列本身已經要求登入（whenLoggedIn），這裡直接送
    const r = await api<{ series: Omit<FormSeries, "items"> }>("/api/catalog/submit", {
      body: { type: "series", artist: owner.slug, title: name, seriesKind: sk, year },
    });
    if (!r.ok) return r.error.message;
    setExtraSeries((xs) => [...xs, { ...r.data.series, items: [] }]);
    setMySeries((xs) => [...xs, r.data.series.key]);
    pickWhere(r.data.series.key);
    return null;
  };
  const renameSeriesSave = async (name: string, year: string) => {
    if (!series) return null;
    const r = await api<{ key: string; title: string; year: string; name: string }>("/api/catalog/rename", {
      body: { type: "series", ref: series.key, name, year },
    });
    if (!r.ok) return r.error.message;
    setSeriesPatch((m) => ({ ...m, [r.data.key]: { title: r.data.title, year: r.data.year, name: r.data.name } }));
    setRenameSeries(false);
    return null;
  };
  const pickVersion = (v: VOpt | null) => {
    setItemPick(v ? v.itemId : null);
    setVersionPick(v ? v.id : "unsure");
    setVersionOpen(false);
    setNewVersion(false);
  };
  const createVersion = async (f: { edition: string; year: string; region: string }) => {
    if (!series || !kind) return "先選專輯";
    const r = await api<{ itemId: string; existing?: boolean; version: Omit<VOpt, "itemId"> }>("/api/catalog/submit", {
      body: { type: "version", seriesKey: series.key, kind, ...f },
    });
    if (!r.ok) return r.error.message;
    const v = { ...r.data.version, itemId: r.data.itemId };
    setExtraVersions((xs) => [...xs, { ...v, seriesKey: series.key, kind }]);
    if (!r.data.existing) setMyVersions((xs) => [...xs, v.key]);
    pickVersion(v);
    return null;
  };
  const renameVersionSave = async (name: string, year: string) => {
    if (!version) return null;
    const r = await api<{ version: VOpt }>("/api/catalog/rename", { body: { type: "version", ref: version.key, name, year } });
    if (!r.ok) return r.error.message;
    setVersionPatch((m) => ({ ...m, [version.key]: { edition: r.data.version.edition, year: r.data.version.year, region: r.data.version.region } }));
    setRenameVersion(false);
    return null;
  };
  const renameArtistSave = async (name: string) => {
    const a = pickedArtists.find((x) => x.slug === renameArtist);
    if (!a) return null;
    const r = await api<{ slug: string; name: string }>("/api/catalog/rename", { body: { type: "artist", ref: a.slug, name } });
    if (!r.ok) return r.error.message;
    setFound((xs) => [{ ...a, name: r.data.name }, ...xs.filter((x) => x.slug !== a.slug)]);
    setAbout((xs) => xs.map((x) => (x === a.name ? r.data.name : x)));
    setRenameArtist(null);
    return null;
  };

  /* ---------- 標題 ---------- */
  const seriesTitle = series?.title ?? (misc ? MISC_SERIES_TITLE : "");
  const autoTitle =
    whereValid && seriesTitle && kind
      ? composeWhat({ series: seriesTitle, item: kindLabel, version: version ? version.edition : "" })
      : pickedArtists.length || kind
        ? composeWhat({ about: pickedArtists.map((a) => a.name), kind: kindLabel })
        : "";
  const title = customTitle || autoTitle;

  /* ---------- 即時錯誤與還差什麼 ---------- */
  const errors: Record<string, string> = {};
  if (picker.items.length === 0) errors.photo = "放一張照片";
  else if (picker.pending) errors.photo = "照片還在上傳，等一下";
  else if (picker.failed) errors.photo = "有照片沒傳上去，按重試或刪掉那張";
  if (pickedArtists.length === 0) errors.about = "選一位，或在框裡打名字";
  if (!kind) errors.kind = "點一個";
  else if (kind === "其他周邊" && !kindNote.trim() && !item) errors.kind = "寫一下是什麼周邊";
  const p = parsePrice(price);
  if (!sold && acc.geo.canTrade && saleState === "sale" && !p) errors.price = "填一個整數金額";
  const missing = [
    ...(picker.items.length === 0 ? [["photo", "照片"]] : []),
    ...(errors.about ? [["about", "誰的東西"]] : []),
    ...(errors.kind ? [["kind", "是什麼"]] : []),
    ...(errors.price ? [["sale", "定價"]] : []),
  ] as [string, string][];
  const optionalLeft = ready && where === null;
  const shown = (k: string) => (tried ? errors[k] : undefined);
  const goTo = (k: string) => document.getElementById(`${id}-sec-${k}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const linkBody = () => {
    const base = { kind, kindNote: kind === "其他周邊" ? kindNote.trim() : "" };
    if (!where || where === "unsure" || !whereValid) return { ...base, ...(pendingSeries ? { pendingSeriesId: pendingSeries.id } : {}) };
    return { ...base, seriesKey: where, ...(item ? { itemId: item.id } : {}), ...(version ? { versionId: version.id } : {}) };
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTried(true);
    setFormError("");
    const first = Object.keys(errors)[0];
    if (first) {
      goTo(first === "price" ? "sale" : first);
      return;
    }
    const content = {
      about: Array.from(new Set(pickedArtists.map((a) => a.name))),
      ...linkBody(),
      story: story.trim(),
      tags: splitTags(tags),
      customTitle: customTitle.trim(),
    };
    if (edit) {
      setBusy(true);
      // 照片有變才存（補、刪、換封面、調順序）；封面換了重畫分享預覽圖
      const ids = picker.items.map((x) => x.id);
      if (ids.join(",") !== initial.map((x) => x.id).join(",")) {
        const r = await api<{ coverChanged: boolean; needOg: boolean }>(`/api/shares/${edit.n}/photos`, { method: "PUT", body: { photoIds: ids } });
        if (!r.ok) {
          setBusy(false);
          return setFormError(r.error.message);
        }
        const cover = picker.items[0];
        if (r.data.needOg && cover?.id) await uploadCoverOg(cover.id, cover.file ?? cover.url ?? "", acc.me?.handle ?? "", cover.code).catch(() => null);
      }
      const saleNext = saleState === "sale" ? { state: "sale" as const, price: p ?? undefined } : { state: saleState };
      const saleChanged = !sold && (saleNext.state !== edit.sale.state || (saleNext.state === "sale" && saleNext.price !== edit.sale.price));
      const r = await api<{ what: string }>(`/api/shares/${edit.n}`, { method: "PUT", body: { ...content, ...(saleChanged ? { sale: saleNext } : {}) } });
      if (!r.ok) {
        setBusy(false);
        return setFormError(r.error.message);
      }
      router.push(`/share/${edit.n}`);
      router.refresh();
      return;
    }
    whenLoggedIn("登入後才能炫收藏", async () => {
      setBusy(true);
      const cover = picker.items[0];
      if (cover?.id && acc.me?.handle) await uploadCoverOg(cover.id, cover.file ?? cover.url ?? "", acc.me.handle, cover.code).catch(() => null);
      const r = await api<{ n: number }>("/api/shares", {
        body: {
          photoIds: picker.items.map((x) => x.id).filter(Boolean),
          ...content,
          sale: !acc.geo.canTrade ? { state: "share" } : saleState === "sale" ? { state: "sale", price: p } : { state: saleState },
        },
      });
      if (!r.ok) {
        setBusy(false);
        return setFormError(r.error.message);
      }
      router.push(`/share/${r.data.n}`);
    });
  };

  /* ---------- 版面 ---------- */
  const whereRows = (list: FormSeries[], testid: string, empty?: string) => {
    const wq = norm(whereQ);
    const hits = wq ? list.filter((w) => norm(w.title).includes(wq) || w.year.includes(wq)) : list;
    const shownRows = wq || showAll ? hits : hits.slice(0, ROWS);
    return (
      <div className="sf-list" role="group" data-testid={testid}>
        {shownRows.map((w) => (
          <button key={w.key} type="button" className="sf-row" aria-pressed={where === w.key} onClick={() => pickWhere(w.key)} data-key={w.key} data-series-kind={w.kind} data-testid="where-opt">
            <span className="sf-row-year">{w.year.slice(0, 4) || "—"}</span>
            <span className="sf-row-name">{w.title}</span>
            <span className="sf-row-kind">{SERIES_KIND_LABEL[w.kind as keyof typeof SERIES_KIND_LABEL] ?? ""}</span>
          </button>
        ))}
        {!wq && !showAll && hits.length > ROWS ? (
          <button type="button" className="sf-row sf-row-more" onClick={() => setShowAll(true)} data-testid="where-more">
            還有 {hits.length - ROWS} 張
          </button>
        ) : null}
        {hits.length === 0 && empty ? <p className="sf-row sf-row-empty">{empty}</p> : null}
      </div>
    );
  };
  const artistName = pickedArtists[0]?.name ?? "";
  const albums = ofKinds("album", "ep", "single");
  const newRow = (sk: "album" | "tour") => (
    <button
      key={sk}
      type="button"
      className="sf-row sf-row-add"
      onClick={() => whenLoggedIn("登入後才能新增", () => setNewBox({ kind: sk, name: whereQ.trim() }))}
      data-testid={`where-new-${sk}`}
    >
      找不到？<b>新增{sk === "tour" ? "演唱會" : "專輯"}{whereQ.trim() ? `「${whereQ.trim()}」` : ""}</b>
    </button>
  );
  const whereAnswer = () => {
    if (where === "unsure" || !whereValid)
      return <Answer testid="bar-where" title="不確定" sub={pendingSeries ? `「${pendingSeries.title}」等待確認` : undefined} action="修改" onAction={() => setWhereOpen(true)} />;
    if (misc) return <Answer testid="bar-where" title={misc.title} sub="藝人自己出的" action="修改" onAction={() => setWhereOpen(true)} />;
    const w = series!;
    const isMine = mySeries.includes(w.key);
    return (
      <Answer
        testid="bar-where"
        title={w.title}
        sub={[w.year.slice(0, 4) || "年份不記得", SERIES_KIND_LABEL[w.kind as keyof typeof SERIES_KIND_LABEL]].filter(Boolean).join("・")}
        isNew={isMine}
        action={isMine ? "改名" : "修改"}
        onAction={() => (isMine ? setRenameSeries(true) : setWhereOpen(true))}
      />
    );
  };

  const summary = (
    <aside className="sf-summary" data-testid="sf-summary" aria-label="發布">
      <span className="sf-cover" aria-hidden="true">
        {picker.items[0]?.preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本機預覽（blob）
          <img src={picker.items[0].preview} alt="" />
        ) : (
          <span className="sf-cover-empty">還沒放照片</span>
        )}
      </span>
      <span className="sf-sum-text">
        <b className={title ? "sf-sum-title" : "sf-sum-title is-empty"} data-testid="sf-title">
          {title || "標題會照你選的自動組好"}
        </b>
        {pickedArtists.length ? (
          <span className="sf-sum-tags">
            {pickedArtists.map((a) => (
              <span key={a.slug} className="tag tag-about">
                {a.name}
              </span>
            ))}
          </span>
        ) : null}
        <span className="sf-sum-missing" data-testid="sf-missing">
          {missing.length ? (
            <button type="button" className="sf-missing-btn" onClick={() => goTo(missing[0][0])}>
              還差{missing.length > 1 ? ` ${missing.length} 題` : ""}：{missing.map((m) => m[1]).join("、")}
            </button>
          ) : optionalLeft ? (
            `還差：${whereShort}（可以跳過）`
          ) : edit ? (
            ""
          ) : (
            "可以發布了"
          )}
        </span>
      </span>
      <span className="sf-sum-acts">
        <button type="submit" className="btn btn-p" disabled={busy || picker.pending > 0} data-testid="share-submit">
          {busy ? (edit ? "儲存中…" : "發布中…") : edit ? "儲存" : "發布"}
        </button>
        {edit ? (
          <button type="button" className="btn-text sf-cancel" onClick={() => router.push(`/share/${edit.n}`)} disabled={busy}>
            取消
          </button>
        ) : null}
      </span>
    </aside>
  );

  return (
    <form className="sf" onSubmit={submit} noValidate data-testid={edit ? "share-edit-form" : "share-form"}>
      <div className="sf-main">
        <div className="field" id={`${id}-sec-photo`}>
          <span className="field-label" id={`${id}-photo`}>
            照片
          </span>
          <div
            onClickCapture={(e) => {
              if (!acc.me && (e.target as HTMLElement).closest("label.drop")) {
                e.preventDefault();
                whenLoggedIn("登入後才能炫收藏", () => undefined);
              }
            }}
          >
            <PhotoPicker picker={picker} labelId={`${id}-photo`} paused={paused} disabled={busy} />
          </div>
          {shown("photo") ? <p className="field-error" data-testid="err-photo">{errors.photo}</p> : null}
        </div>

        <section className="sf-group" aria-labelledby={`${id}-g1`}>
          <div className="sf-group-head">
            <h2 id={`${id}-g1`}>這是什麼</h2>
            <span>前兩題必答</span>
          </div>

          <div className="field" id={`${id}-sec-about`}>
            <span className="field-label" id={`${id}-about-l`}>
              誰的東西？
            </span>
            {!aboutOpen && pickedArtists.length ? (
              renameArtist ? (
                <NameBox
                  testid="rename-artist"
                  heading="改名"
                  initialName={pickedArtists.find((a) => a.slug === renameArtist)?.name ?? ""}
                  withYear={false}
                  saveLabel="儲存"
                  cancelLabel="換成別的"
                  onSave={(n) => renameArtistSave(n)}
                  onCancel={() => {
                    setRenameArtist(null);
                    setAboutOpen(true);
                  }}
                />
              ) : (
                pickedArtists.map((a) => {
                  const isMine = myArtists.includes(a.slug);
                  return (
                    <Answer
                      key={a.slug}
                      testid="bar-about"
                      title={a.name}
                      sub={a.aliases[0]}
                      isNew={isMine}
                      action={isMine ? "改名" : "修改"}
                      onAction={() => (isMine ? setRenameArtist(a.slug) : setAboutOpen(true))}
                    />
                  );
                })
              )
            ) : (
              <>
                {about.length ? (
                  <div className="chip-row">
                    {about.map((t) => (
                      <span className="chip" key={t}>
                        {t}
                        <button type="button" aria-label={`移除 ${t}`} onClick={() => setArtists(about.filter((x) => x !== t))}>
                          ×
                        </button>
                      </span>
                    ))}
                    <button type="button" className="btn-text" onClick={() => setAboutOpen(false)}>
                      好了
                    </button>
                  </div>
                ) : null}
                <label className="sr-only" htmlFor={`${id}-about`}>
                  打歌手或樂團的名字
                </label>
                <input
                  id={`${id}-about`}
                  className="input"
                  placeholder="打歌手或樂團的名字"
                  value={aboutDraft}
                  onChange={(e) => setAboutDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (exact) pickArtist(exact);
                      else if (suggestions[0]) pickArtist(suggestions[0]);
                    }
                  }}
                  aria-invalid={Boolean(shown("about"))}
                  autoComplete="off"
                  data-testid="artist-search"
                />
                {q ? (
                  <div className="sf-list sf-suggest" data-testid="artist-results">
                    {suggestions.map((a) => (
                      <button key={a.slug} type="button" className="sf-row" onClick={() => pickArtist(a)} data-testid="artist-opt" data-slug={a.slug}>
                        <span className="sf-row-name">
                          <b>{a.name}</b> {a.aliases[0] ? <span className="sub-inline">{a.aliases[0]}</span> : null}
                        </span>
                      </button>
                    ))}
                    {settled && !exact ? (
                      <button type="button" className="sf-row sf-row-add" onClick={() => createArtist(aboutDraft.trim())} data-testid="artist-new">
                        找不到？<b>新增「{aboutDraft.trim()}」</b>
                      </button>
                    ) : null}
                    {!settled && !suggestions.length ? <p className="sf-row sf-row-empty">找找看…</p> : null}
                  </div>
                ) : (
                  <>
                    <span className="sf-hint">最近常發的</span>
                    <div className="picks picks-artist" role="group" aria-labelledby={`${id}-about-l`} data-testid="pick-artist">
                      {options.defaultArtists.map((a) => (
                        <button key={a.slug} type="button" className="pick pick-artist" aria-pressed={about.includes(a.name)} onClick={() => pickArtist(a)}>
                          {a.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {shown("about") ? <p className="field-error" data-testid="err-about">{errors.about}</p> : null}
          </div>

          <div className="field" id={`${id}-sec-kind`}>
            <span className="field-label" id={`${id}-kind`}>
              是什麼？
            </span>
            {kind && !kindOpen ? (
              <Answer testid="bar-kind" title={kind} action="修改" onAction={() => setKindOpen(true)} />
            ) : (
              <div className="picks" role="group" aria-labelledby={`${id}-kind`} data-testid="pick-kind">
                {KINDS.map((k) => (
                  <button key={k} type="button" className="pick" aria-pressed={kind === k} onClick={() => pickKind(k)}>
                    {k}
                  </button>
                ))}
              </div>
            )}
            {kind === "其他周邊" ? (
              <div className="field-sub field-sub-wide">
                <label className="sr-only" htmlFor={`${id}-kind-note`}>
                  是什麼周邊
                </label>
                <input id={`${id}-kind-note`} className="input" placeholder="例：手環、貼紙、票根" value={kindNote} onChange={(e) => setKindNote(e.target.value)} />
              </div>
            ) : null}
            {shown("kind") ? <p className="field-error" data-testid="err-kind">{errors.kind}</p> : null}
          </div>

          <div className={ready ? "field" : "field is-dim"} data-testid="where" id={`${id}-sec-where`}>
            <span className="field-label" id={`${id}-where`}>
              {whereQuestion}
            </span>
            {!ready ? (
              <p className="sf-placeholder">先選上面兩題，這裡會列出{record || !kind ? "他的專輯" : "出處"}</p>
            ) : where !== null && !whereOpen ? (
              renameSeries && series ? (
                <>
                  {whereAnswer()}
                  <NameBox
                    testid="rename-series"
                    heading="改名"
                    initialName={series.title}
                    initialYear={series.year.slice(0, 4)}
                    noYearAtStart={!series.year}
                    withYear
                    saveLabel="儲存"
                    cancelLabel="換成別的"
                    onSave={renameSeriesSave}
                    onCancel={() => {
                      setRenameSeries(false);
                      setWhereOpen(true);
                    }}
                  />
                </>
              ) : (
                whereAnswer()
              )
            ) : (
              <>
                <input
                  className="input"
                  value={whereQ}
                  onChange={(e) => setWhereQ(e.target.value)}
                  placeholder={`打${record ? "專輯" : "演唱會或專輯"}名找${albums[0] ? `，例：${albums[0].title}` : ""}`}
                  aria-labelledby={`${id}-where`}
                  data-testid="where-search"
                  autoComplete="off"
                />
                {record ? (
                  whereRows(albums, "where-record", whereQ ? undefined : `${artistName}還沒有專輯資料`)
                ) : (
                  <>
                    <span className="sf-sec">演唱會</span>
                    {whereRows(ofKinds("tour"), "where-tour", `${artistName}還沒有演唱會資料`)}
                    <span className="sf-sec">專輯的周邊</span>
                    {whereRows(albums, "where-album", `${artistName}還沒有專輯資料`)}
                    <span className="sf-sec">藝人自己出的</span>
                    <div className="sf-list" data-testid="where-brand">
                      {ofKinds("brand")
                        .filter((w) => !whereQ || norm(w.title).includes(norm(whereQ)))
                        .map((w) => (
                          <button key={w.key} type="button" className="sf-row" aria-pressed={where === w.key} onClick={() => pickWhere(w.key)} data-key={w.key} data-series-kind="brand" data-testid="where-opt">
                            <span className="sf-row-year">{w.year.slice(0, 4) || "—"}</span>
                            <span className="sf-row-name">{w.title}</span>
                          </button>
                        ))}
                      {miscOptions.map((m) => (
                        <button key={m.key} type="button" className="sf-row" aria-pressed={where === m.key} onClick={() => pickWhere(m.key)} data-key={m.key} data-series-kind="misc" data-testid="where-opt">
                          <span className="sf-row-year">—</span>
                          <span className="sf-row-name">{m.title}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="sf-list sf-list-tail">
                  {record ? newRow("album") : [newRow("tour"), newRow("album")]}
                  <button type="button" className="sf-row sf-row-skip" aria-pressed={where === "unsure"} onClick={() => pickWhere("unsure")} data-key="unsure" data-testid="where-unsure">
                    不確定，先跳過
                  </button>
                </div>
                {newBox ? (
                  <NameBox
                    key={`${newBox.kind}-${newBox.name}`}
                    testid="new-box"
                    heading={newBox.kind === "tour" ? "新增演唱會" : "新增專輯"}
                    initialName={newBox.name}
                    initialYear=""
                    withYear
                    saveLabel="用這個名字"
                    cancelLabel="取消"
                    onSave={(n, y) => createSeries(newBox.kind, n, y)}
                    onCancel={() => setNewBox(null)}
                  />
                ) : null}
              </>
            )}
          </div>

          {ready && series && kind && series.kind !== "misc" && where !== null && !whereOpen ? (
            <div className="field" data-testid="version-field" id={`${id}-sec-version`}>
              <span className="field-label" id={`${id}-version`}>
                哪個版本？ <span className="opt">選填</span>
              </span>
              {!versionOpen ? (
                renameVersion && version ? (
                  <>
                    <Answer testid="bar-version" title={versionLabel(version, kindLabel)} isNew action="改名" onAction={() => setRenameVersion(true)} />
                    <NameBox
                      testid="rename-version"
                      heading="改版本名稱"
                      initialName={version.edition}
                      initialYear={version.year}
                      noYearAtStart={!version.year}
                      withYear
                      saveLabel="儲存"
                      cancelLabel="換成別的"
                      onSave={renameVersionSave}
                      onCancel={() => {
                        setRenameVersion(false);
                        setVersionOpen(true);
                      }}
                    />
                  </>
                ) : (
                  <Answer
                    testid="bar-version"
                    title={version ? versionLabel(version, kindLabel) : "不確定"}
                    isNew={Boolean(version && myVersions.includes(version.key))}
                    action={version && myVersions.includes(version.key) ? "改名" : "修改"}
                    onAction={() => (version && myVersions.includes(version.key) ? setRenameVersion(true) : setVersionOpen(true))}
                  />
                )
              ) : (
                <>
                  <div className="sf-list" role="group" aria-labelledby={`${id}-version`} data-testid="pick-version">
                    {vOpts.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        className="sf-row"
                        aria-pressed={version?.key === v.key}
                        onClick={() => pickVersion(v)}
                        data-key={v.key}
                        data-testid="version-opt"
                      >
                        <span className="sf-row-name">{versionLabel(v, kindLabel)}</span>
                      </button>
                    ))}
                    <button type="button" className="sf-row sf-row-skip" aria-pressed={!version} onClick={() => pickVersion(null)} data-testid="version-unsure">
                      不確定
                    </button>
                    <button type="button" className="sf-row sf-row-add" onClick={() => whenLoggedIn("登入後才能新增", () => setNewVersion(true))} data-testid="version-new">
                      <b>新增版本</b>
                    </button>
                  </div>
                  {newVersion ? <NewVersionBox onSave={createVersion} onCancel={() => setNewVersion(false)} /> : null}
                </>
              )}
            </div>
          ) : null}
        </section>

        <section className="sf-group" aria-labelledby={`${id}-g2`}>
          <div className="sf-group-head">
            <h2 id={`${id}-g2`}>想多說一點</h2>
            <span>都可以不填</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${id}-story`}>
              想說的話
            </label>
            <textarea id={`${id}-story`} className="input textarea" rows={4} placeholder="例：2016 年簽名會現場買的，側標還在" value={story} onChange={(e) => setStory(e.target.value)} />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${id}-tags`}>
              標籤
            </label>
            <input id={`${id}-tags`} className="input" placeholder="例：簽名、初回、側標" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>

          <div className="field" data-testid="title-field">
            <label className="field-label" htmlFor={`${id}-title`}>
              標題
            </label>
            {titleOpen || customTitle ? (
              <>
                <input
                  id={`${id}-title`}
                  className="input"
                  maxLength={80}
                  value={customTitle || autoTitle}
                  placeholder="標題會照你選的自動組好"
                  onChange={(e) => setCustomTitle(e.target.value === autoTitle ? "" : e.target.value)}
                  data-testid="title-input"
                />
                {customTitle ? (
                  <button type="button" className="btn-text sf-title-reset" onClick={() => (setCustomTitle(""), setTitleOpen(false))} data-testid="title-reset">
                    還原成自動標題{autoTitle ? `「${autoTitle}」` : ""}
                  </button>
                ) : null}
              </>
            ) : (
              <Answer testid="bar-title" title={autoTitle || "標題會照你選的自動組好"} action="修改" onAction={() => setTitleOpen(true)} />
            )}
          </div>

          <div className="field" id={`${id}-sec-sale`}>
            <span className="field-label" id={`${id}-sale`}>
              要不要賣
            </span>
            {!acc.geo.canTrade && !sold ? (
              <p className="region-note" data-testid="region-note">
                交易僅限台灣地區
              </p>
            ) : (
              <div className="seg" role="group" aria-labelledby={`${id}-sale`}>
                {(
                  [
                    ["share", "純分享"],
                    ["offer", "開放出價"],
                    ["sale", "定價出售"],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={sold ? k === "sale" : saleState === k} disabled={sold} onClick={() => setSaleState(k)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {sold ? (
              <p className="sub" data-testid="sale-sold-note">
                已成交，出售狀態與價格不能改
              </p>
            ) : null}
            {!sold && acc.geo.canTrade && saleState === "sale" ? (
              <div className="field-sub">
                <MoneyInput id={`${id}-price`} value={price} onChange={setPrice} label="定價" />
                {shown("price") ? <p className="field-error" data-testid="err-price">{errors.price}</p> : null}
              </div>
            ) : null}
          </div>
          {formError ? (
            <p className="field-error" role="alert" data-testid="form-error">
              {formError}
            </p>
          ) : null}
        </section>
      </div>
      {summary}
    </form>
  );
}
