"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  GENDER_LABEL,
  isRecordKind,
  KINDS,
  MISC_SERIES_TITLE,
  miscSeriesRef,
  norm,
  REGION_LABEL,
  SERIES_KIND_LABEL,
  type ArtistGender,
  type ArtistRegion,
  type Kind,
  type SaleState,
  type SeriesKind,
} from "@/lib/data";
import type { FormOptions } from "@/lib/catalog";
import { api, useAccount, whenLoggedIn } from "@/lib/account";
import { uploadCoverOg } from "@/lib/image";
import { PhotoPicker, usePhotoPicker } from "@/components/photo-picker";
import { MoneyInput, parsePrice } from "@/components/share-detail";

function splitTags(s: string) {
  return s
    .split(/[,，、\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 一排可點的標籤，單選或多選都用 aria-pressed */
function PickRow<T extends string>({
  label,
  options,
  value,
  onPick,
  testid,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: (k: T) => boolean;
  onPick: (k: T) => void;
  testid?: string;
}) {
  return (
    <div className="picks" role="group" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button key={o.key} type="button" className="pick" aria-pressed={value(o.key)} onClick={() => onPick(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const GENDERS = (Object.keys(GENDER_LABEL) as ArtistGender[]).map((k) => ({ key: k, label: GENDER_LABEL[k] }));
const REGIONS = (Object.keys(REGION_LABEL) as ArtistRegion[]).map((k) => ({ key: k, label: REGION_LABEL[k] }));

type FormArtist = FormOptions["defaultArtists"][number];
type FormSeries = FormOptions["series"][number];

/**
 * 「這裡沒有，我要新增」：藝人、版本。送出後是待審核，管理員在後台核准才出現（管理員新增直接生效）。
 * parent 是上一層的鍵。系列另外用 SubmitSeries（新增完可以直接選）。
 */
function SubmitNew({ type, parent, label }: { type: "artist" | "version"; parent?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<"" | "pending" | "approved">("");
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  if (done) return <span className="sub" role="status">{done === "approved" ? "已新增，重新整理後就能選" : "已送出，等管理員審核"}</span>;
  if (!open) {
    return (
      <button type="button" className="pick pick-add" onClick={() => whenLoggedIn("登入後才能新增", () => setOpen(true))}>
        {label}
      </button>
    );
  }
  const fields: { k: string; label: string; ph?: string }[] =
    type === "artist"
      ? [
          { k: "name", label: "藝人名稱" },
          { k: "slug", label: "網址（英文名或音譯）", ph: "例：elephant-gym" },
        ]
      : [
          { k: "edition", label: "版本名稱", ph: "首批、日版、再版…" },
          { k: "year", label: "年份" },
          { k: "catalog", label: "目錄號" },
        ];
  const send = async () => {
    const body: Record<string, unknown> = { type, ...f };
    if (type === "version") body.itemKey = parent;
    const r = await api<{ approved?: boolean }>("/api/catalog/submit", { body });
    if (r.ok) setDone(r.data.approved ? "approved" : "pending");
    else setError(r.error.message);
  };
  return (
    <div className="submit-new" data-testid={`submit-${type}`}>
      {fields.map((x) => (
        <label key={x.k} className="submit-field">
          <span>{x.label}</span>
          <input className="input input-sm" placeholder={x.ph} value={f[x.k] ?? ""} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} />
        </label>
      ))}
      {error ? <p className="field-error">{error}</p> : null}
      <span className="report-acts">
        <button type="button" className="btn btn-line" onClick={send}>
          送出審核
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </span>
    </div>
  );
}

type NewSeriesKind = Exclude<SeriesKind, "misc">;
const NEW_SERIES_KINDS: NewSeriesKind[] = ["album", "ep", "single", "tour", "brand"];

/**
 * 新增系列（2026-09-28 周邊選擇流程）：名稱、類型、年份（可勾不記得）。
 * 「新增一場演唱會／巡迴」＝類型固定巡迴。管理員新增直接生效並選好；會員新增進審核佇列，
 * 這則收藏先掛「不確定」，核准後自動改掛到新系列。
 */
function SubmitSeries({
  artists,
  label,
  fixedKind,
  kinds = NEW_SERIES_KINDS,
  defaultKind = "album",
  testid,
  onCreated,
  onPending,
}: {
  artists: FormArtist[];
  label: string;
  fixedKind?: NewSeriesKind;
  kinds?: NewSeriesKind[];
  defaultKind?: NewSeriesKind;
  testid: string;
  onCreated: (w: FormSeries) => void;
  onPending: (p: { id: number; title: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [noYear, setNoYear] = useState(false);
  const [kind, setKind] = useState<NewSeriesKind>(fixedKind ?? defaultKind);
  const [artist, setArtist] = useState(artists[0]?.slug ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="pick pick-add" data-testid={testid} onClick={() => whenLoggedIn("登入後才能新增", () => setOpen(true))}>
        {label}
      </button>
    );
  }
  const owner = artists.some((a) => a.slug === artist) ? artist : (artists[0]?.slug ?? "");
  const send = async () => {
    if (!title.trim()) return setError(fixedKind === "tour" ? "填演唱會或巡迴名稱" : "填系列名稱");
    if (!noYear && !/^\d{4}$/.test(year.trim())) return setError("填年份（西元四位數），或勾「不記得」");
    setBusy(true);
    const r = await api<{ approved?: boolean; id: number; series: Omit<FormSeries, "items"> }>("/api/catalog/submit", {
      body: { type: "series", artist: owner, title: title.trim(), seriesKind: kind, year: noYear ? "" : year.trim() },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setOpen(false);
    setTitle("");
    setYear("");
    if (r.data.approved) onCreated({ ...r.data.series, items: [] });
    else onPending({ id: r.data.id, title: r.data.series.title });
  };
  return (
    <div className="submit-new" data-testid={`${testid}-form`}>
      {artists.length > 1 ? (
        <div className="picks" role="group" aria-label="掛在哪位藝人底下">
          {artists.map((a) => (
            <button key={a.slug} type="button" className="pick" aria-pressed={owner === a.slug} onClick={() => setArtist(a.slug)}>
              {a.name}
            </button>
          ))}
        </div>
      ) : null}
      <label className="submit-field">
        <span>{fixedKind === "tour" ? "演唱會／巡迴名稱" : "系列名稱"}</span>
        <input
          className="input input-sm"
          placeholder={fixedKind === "tour" ? "例：2024 夏日巡迴" : "例：夜行採集"}
          value={title}
          maxLength={60}
          onChange={(e) => setTitle(e.target.value)}
          data-testid={`${testid}-title`}
        />
      </label>
      {fixedKind ? null : (
        <div className="picks" role="group" aria-label="類型" data-testid={`${testid}-kind`}>
          {kinds.map((k) => (
            <button key={k} type="button" className="pick" aria-pressed={kind === k} onClick={() => setKind(k)} data-kind={k}>
              {SERIES_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      <div className="submit-field submit-year">
        <label htmlFor={`${testid}-year`}>年份</label>
        <input
          id={`${testid}-year`}
          className="input input-sm"
          inputMode="numeric"
          maxLength={4}
          placeholder="2024"
          disabled={noYear}
          value={noYear ? "" : year}
          onChange={(e) => setYear(e.target.value)}
          data-testid={`${testid}-year`}
        />
        <label className="check-inline">
          <input type="checkbox" checked={noYear} onChange={(e) => setNoYear(e.target.checked)} data-testid={`${testid}-noyear`} />
          不記得
        </label>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <span className="report-acts">
        <button type="button" className="btn btn-line" onClick={send} disabled={busy} data-testid={`${testid}-send`}>
          {busy ? "送出中…" : "新增"}
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </span>
    </div>
  );
}

/** 編輯已發布的炫收藏（2026-09-28）：照片另外在單則頁「編輯照片」改，這裡只改內容與出售狀態 */
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
  /** 這則「跟誰有關」對得到的藝人（不在預設清單裡也要能拼出系列選項） */
  artists: FormArtist[];
  /** 這位會員新增、還在審核的系列（這則先掛「不確定」） */
  pendingSeries?: { id: number; title: string } | null;
};

export function ShareForm({ options, edit }: { options: FormOptions; edit?: ShareEdit }) {
  const router = useRouter();
  const acc = useAccount();
  const id = "share-form";
  const [paused, setPaused] = useState(false);
  const picker = usePhotoPicker([], () => setPaused(true));
  const [gender, setGender] = useState<ArtistGender | null>(null);
  const [region, setRegion] = useState<ArtistRegion | null>(null);
  const [about, setAbout] = useState<string[]>(edit?.about ?? []);
  const [aboutDraft, setAboutDraft] = useState("");
  /** 「更多」按鈕：預設只列 options.defaultArtists（最多 10 位），按下去才加進 options.moreArtists */
  const [expanded, setExpanded] = useState(false);
  /** 打字搜尋結果（/api/artists/search），累積起來讓選過的藝人之後也查得到 slug（拼系列用） */
  const [found, setFound] = useState<FormArtist[]>(edit?.artists ?? []);
  /** 屬於哪裡：系列鍵、「misc:{藝人}」（周邊與其他，還沒建立）、"unsure"（不確定）；null＝還沒選（送出時當不確定） */
  const [where, setWhere] = useState<string | null>(edit ? (edit.seriesKey ?? "unsure") : null);
  const [itemPick, setItemPick] = useState<string | null>(edit?.itemId ?? null);
  const [versionPick, setVersionPick] = useState<string>(edit?.versionId ?? "unsure");
  const [kind, setKind] = useState<Kind | null>(edit?.kind ?? null);
  /** 管理員剛新增、直接生效的系列（頁面的系列清單是載入時的，要自己併進來） */
  const [extraSeries, setExtraSeries] = useState<FormSeries[]>([]);
  /** 會員剛新增、等審核的系列：這則先掛不確定，核准後自動改掛 */
  const [pendingSeries, setPendingSeries] = useState<{ id: number; title: string } | null>(edit?.pendingSeries ?? null);
  const [kindNote, setKindNote] = useState(edit?.kindNote ?? "");
  const [story, setStory] = useState(edit?.story ?? "");
  const [tags, setTags] = useState(edit?.tags.join("、") ?? "");
  const initialSale: SaleState = edit?.sale.state ?? "share";
  const [saleState, setSaleState] = useState<SaleState>(initialSale === "sold" ? "share" : initialSale);
  const [price, setPrice] = useState(edit?.sale.price ? String(edit.sale.price) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** 編輯時：出售狀態與價格只有發文者能改，已成交的不能改 */
  const sold = initialSale === "sold";

  useEffect(() => {
    if (edit) return;
    void api<{ paused: boolean }>("/api/uploads").then((r) => r.ok && setPaused(r.data.paused));
  }, [edit]);

  /** 表單目前列出的藝人：預設清單，按過「更多」才加上其餘強制顯示的 */
  const visibleArtists = expanded ? [...options.defaultArtists, ...options.moreArtists] : options.defaultArtists;
  /** 已知的藝人（拼系列、解析打字輸入用）：目前列出的＋打字搜尋查到過的，不限於預設清單 */
  const known = [...options.defaultArtists, ...options.moreArtists, ...found];

  const resolveTagArtist = (t: string): FormArtist | undefined => {
    const q = norm(t);
    return known.find((a) => norm(a.name) === q || a.aliases.some((x) => norm(x) === q));
  };

  const shownArtists = visibleArtists.filter((a) => {
    if (!gender && !region) return true;
    if (a.kind !== "藝人") return false;
    return (!gender || a.gender === gender) && (!region || a.region === region);
  });

  /**
   * 打字搜尋：debounce 300ms 打 /api/artists/search，查全部藝人（含還沒出現在預設清單的）。
   * `searchedQuery` 記下「最後一次查完的字」：搜尋還沒回來前不顯示「這是新標籤」的回退選項，
   * 避免打完整名字後立刻點到「當標籤」而不是真的那位藝人（兩顆按鈕文字這時候看起來一樣）。
   */
  const [searchedQuery, setSearchedQuery] = useState("");
  useEffect(() => {
    const draft = aboutDraft.trim();
    if (!draft) return;
    const t = setTimeout(() => {
      void api<{ artists: FormArtist[] }>(`/api/artists/search?q=${encodeURIComponent(draft)}`).then((r) => {
        setSearchedQuery(draft.toLowerCase());
        if (!r.ok) return;
        setFound((prev) => {
          const seen = new Set(prev.map((a) => a.slug));
          const next = [...prev];
          for (const a of r.data.artists) if (!seen.has(a.slug)) {
              seen.add(a.slug);
              next.push(a);
            }
          return next;
        });
      });
    }, 300);
    return () => clearTimeout(t);
  }, [aboutDraft]);

  const q = aboutDraft.trim().toLowerCase();
  const suggestions = q
    ? found.filter(
        (a) =>
          !about.includes(a.name) &&
          (a.name.toLowerCase().includes(q) || a.aliases.some((x) => x.toLowerCase().includes(q))),
      )
    : [];
  /** 搜尋還沒查完這個字之前，不能斷定「這裡沒有」 */
  const searchSettled = searchedQuery === q;

  const toggleAbout = (name: string) => {
    setAbout(about.includes(name) ? about.filter((x) => x !== name) : [...about, name]);
  };

  /** 點打字搜尋出來的建議：直接把整個藝人物件併進 known，不用等下一輪搜尋回來才解析得到 */
  const pickSuggestion = (a: FormArtist) => {
    setFound((prev) => (prev.some((x) => x.slug === a.slug) ? prev : [...prev, a]));
    if (!about.includes(a.name)) setAbout([...about, a.name]);
    setAboutDraft("");
  };

  const addAbout = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const name = resolveTagArtist(t)?.name ?? t;
    if (!about.includes(name)) setAbout([...about, name]);
    setAboutDraft("");
  };

  /** 選到的藝人的系列（共同署名兩邊都算，不重複），加上剛新增的 */
  const pickedArtists = about.map((n) => resolveTagArtist(n)).filter((a): a is FormArtist => Boolean(a));
  const allSeries = [...options.series, ...extraSeries];
  const seriesOptions: FormSeries[] = [];
  pickedArtists.forEach((a) => {
    allSeries
      .filter((w) => w.credits.includes(a.slug))
      .forEach((w) => {
        if (!seriesOptions.some((x) => x.key === w.key)) seriesOptions.push(w);
      });
  });
  // 編輯時原本掛的系列：藝人改掉了也要留著能選
  const current = where && !seriesOptions.some((w) => w.key === where) ? allSeries.find((w) => w.key === where) : undefined;
  if (current) seriesOptions.push(current);
  const newest = (x: FormSeries, y: FormSeries) => (Number(y.year.slice(0, 4)) || 0) - (Number(x.year.slice(0, 4)) || 0);
  const ofKinds = (...ks: SeriesKind[]) => seriesOptions.filter((w) => ks.includes(w.kind)).sort(newest);
  /** 每位選到的藝人一個「周邊與其他」：已經有了用它的鍵，還沒有用 misc:{藝人}（第一次發布時才建） */
  const miscOptions = pickedArtists.map((a) => {
    const w = allSeries.find((x) => x.kind === "misc" && x.credits[0] === a.slug);
    return {
      key: w?.key ?? miscSeriesRef(a.slug),
      label: pickedArtists.length > 1 ? `${MISC_SERIES_TITLE}（${a.name}）` : MISC_SERIES_TITLE,
      series: w,
    };
  });
  const record = kind ? isRecordKind(kind) : false;
  const series = where ? (seriesOptions.find((w) => w.key === where) ?? miscOptions.find((m) => m.key === where)?.series) : undefined;
  /** 這個系列裡跟選的品項同類的品項 */
  const sameKind = series && kind ? series.items.filter((i) => i.kind === kind) : [];
  const item = sameKind.length === 1 ? sameKind[0] : sameKind.find((i) => i.id === itemPick);
  const version = item?.versions.find((v) => v.id === versionPick);
  const whereValid = where === "unsure" || Boolean(series) || miscOptions.some((m) => m.key === where);

  const pickKind = (k: Kind) => {
    const next = kind === k ? null : k;
    // 唱片類與周邊類的「屬於哪裡」清單不同，換類別就重選
    if (!next || !kind || isRecordKind(next) !== isRecordKind(kind)) setWhere(null);
    setKind(next);
    setItemPick(null);
    setVersionPick("unsure");
  };
  const pickWhere = (k: string) => {
    setWhere(where === k ? null : k);
    setItemPick(null);
    setVersionPick("unsure");
    if (k !== "unsure") setPendingSeries(null);
  };
  const addCreated = (w: FormSeries) => {
    setExtraSeries((prev) => [...prev, w]);
    setPendingSeries(null);
    setWhere(w.key);
    setItemPick(null);
    setVersionPick("unsure");
  };
  const addPending = (p: { id: number; title: string }) => {
    setPendingSeries(p);
    setWhere("unsure");
  };
  /** 送出用的「屬於哪裡」 */
  const linkBody = () => {
    const base = { kind, kindNote: kind === "其他周邊" ? kindNote.trim() : "" };
    if (!where || where === "unsure" || !whereValid) return { ...base, ...(pendingSeries ? { pendingSeriesId: pendingSeries.id } : {}) };
    return {
      ...base,
      seriesKey: where,
      ...(item ? { itemId: item.id } : {}),
      ...(item && version ? { versionId: version.id } : {}),
    };
  };

  const whereBtn = (key: string, label: string, testKind?: string) => (
    <button key={key} type="button" className="pick" aria-pressed={where === key} onClick={() => pickWhere(key)} data-key={key} data-series-kind={testKind}>
      {label}
    </button>
  );
  const seriesBtns = (list: FormSeries[]) => list.map((w) => whereBtn(w.key, w.name, w.kind));
  const unsureBtn = whereBtn("unsure", "不確定");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pending = aboutDraft.trim() ? [...about, resolveTagArtist(aboutDraft)?.name ?? aboutDraft.trim()] : about;
    const next: Record<string, string> = {};
    if (edit) {
      /* 編輯不動照片 */
    } else if (picker.items.length === 0) next.photo = "至少放一張照片";
    else if (picker.pending) next.photo = "照片還在上傳，等一下";
    else if (picker.failed) next.photo = "有照片沒傳上去，按重試或刪掉那張";
    if (pending.length === 0) next.about = "至少點一位";
    if (!kind) next.kind = "點一個品項";
    if (kind === "其他周邊" && !kindNote.trim() && !item) next.kind = "寫一下是什麼周邊";
    const p = parsePrice(price);
    if (saleState === "sale" && !p && !sold) next.price = "填一個整數金額";
    setErrors(next);
    if (Object.keys(next).length || !kind) return;

    if (edit) {
      setBusy(true);
      const content = {
        about: Array.from(new Set(pending)),
        ...linkBody(),
        story: story.trim(),
        tags: splitTags(tags),
      };
      // 出售狀態沒變就不送（海外會員改說明不會被「交易僅限台灣」擋下）
      const saleNext = saleState === "sale" ? { state: "sale" as const, price: p ?? undefined } : { state: saleState };
      const saleChanged = !sold && (saleNext.state !== edit.sale.state || (saleNext.state === "sale" && saleNext.price !== edit.sale.price));
      const r = await api<{ what: string }>(`/api/shares/${edit.n}`, {
        method: "PUT",
        body: { ...content, ...(saleChanged ? { sale: saleNext } : {}) },
      });
      if (!r.ok) {
        setBusy(false);
        setErrors({ form: r.error.message });
        return;
      }
      router.push(`/share/${edit.n}`);
      router.refresh();
      return;
    }

    whenLoggedIn("登入後才能炫收藏", async () => {
      setBusy(true);
      // 分享預覽圖只替封面（第一張）畫；畫不出來不擋發文，og:image 會退回縮圖
      const cover = picker.items[0];
      if (cover?.id && acc.me?.handle) await uploadCoverOg(cover.id, cover.file ?? cover.url ?? "", acc.me.handle).catch(() => null);
      const r = await api<{ n: number }>("/api/shares", {
        body: {
          photoIds: picker.items.map((x) => x.id).filter(Boolean),
          about: Array.from(new Set(pending)),
          ...linkBody(),
          story: story.trim(),
          tags: splitTags(tags),
          sale: !acc.geo.canTrade ? { state: "share" } : saleState === "sale" ? { state: "sale", price: p } : { state: saleState },
        },
      });
      if (!r.ok) {
        setBusy(false);
        setErrors({ form: r.error.message });
        return;
      }
      router.push(`/share/${r.data.n}`);
    });
  };

  return (
    <form className="form" onSubmit={submit} noValidate data-testid={edit ? "share-edit-form" : undefined}>
      {edit ? null : (
      <div className="field">
        <span className="field-label" id={`${id}-photo`}>
          照片
        </span>
        <div onClickCapture={(e) => {
            // 選照片要登入：沒登入先跳登入，不打開檔案選擇
            if (!acc.me && (e.target as HTMLElement).closest("label.drop")) {
              e.preventDefault();
              whenLoggedIn("登入後才能炫收藏", () => undefined);
            }
          }}>
          <PhotoPicker picker={picker} labelId={`${id}-photo`} paused={paused} disabled={busy} />
        </div>
        {errors.photo ? <p className="field-error">{errors.photo}</p> : null}
      </div>
      )}

      <div className="field">
        <span className="field-label" id={`${id}-about-l`}>
          跟誰有關
        </span>
        <div className="filter-picks">
          <PickRow
            label="類型"
            options={GENDERS}
            value={(k) => gender === k}
            onPick={(k) => setGender(gender === k ? null : k)}
            testid="pick-gender"
          />
          <PickRow
            label="地區"
            options={REGIONS}
            value={(k) => region === k}
            onPick={(k) => setRegion(region === k ? null : k)}
            testid="pick-region"
          />
        </div>
        <div className="picks picks-artist" role="group" aria-labelledby={`${id}-about-l`} data-testid="pick-artist">
          {shownArtists.map((a) => (
            <button
              key={a.slug}
              type="button"
              className="pick pick-artist"
              aria-pressed={about.includes(a.name)}
              onClick={() => toggleAbout(a.name)}
            >
              {a.name}
            </button>
          ))}
          {shownArtists.length === 0 ? <span className="sub">這個分類還沒有藝人</span> : null}
          {!expanded && options.moreArtists.length ? (
            <button type="button" className="pick pick-more" onClick={() => setExpanded(true)} data-testid="pick-more">
              更多
            </button>
          ) : null}
          <SubmitNew type="artist" label="找不到藝人，我要新增" />
        </div>
        <p className="sub" data-testid="about-search-hint">
          找不到？打字搜尋全部藝人
        </p>
        {about.filter((t) => !visibleArtists.some((a) => a.name === t)).length ? (
          <div className="chip-row">
            {about
              .filter((t) => !visibleArtists.some((a) => a.name === t))
              .map((t) => (
                <span className="chip" key={t}>
                  {t}
                  <button type="button" aria-label={`移除 ${t}`} onClick={() => setAbout(about.filter((x) => x !== t))}>
                    ×
                  </button>
                </span>
              ))}
          </div>
        ) : null}
        <label className="sr-only" htmlFor={`${id}-about`}>
          打字找藝人
        </label>
        <input
          id={`${id}-about`}
          className="input input-sm"
          placeholder="找不到？打字搜尋"
          value={aboutDraft}
          onChange={(e) => setAboutDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && !e.nativeEvent.isComposing) {
              e.preventDefault();
              addAbout(aboutDraft);
            }
          }}
          aria-invalid={Boolean(errors.about)}
          autoComplete="off"
        />
        {suggestions.length || q ? (
          <ul className="suggest">
            {suggestions.map((a) => (
              <li key={a.slug}>
                <button type="button" onClick={() => pickSuggestion(a)}>
                  <b>{a.name}</b>
                  <span>{a.kind}</span>
                </button>
              </li>
            ))}
            {q && searchSettled && !resolveTagArtist(aboutDraft) ? (
              <li>
                <button type="button" onClick={() => addAbout(aboutDraft)}>
                  <b>「{aboutDraft.trim()}」</b>
                  <span>標籤</span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
        {errors.about ? <p className="field-error">{errors.about}</p> : null}
      </div>

      <div className="field">
        <span className="field-label" id={`${id}-kind`}>
          是什麼東西
        </span>
        <div className="picks" role="group" aria-labelledby={`${id}-kind`} data-testid="pick-kind">
          {KINDS.map((k) => (
            <button key={k} type="button" className="pick" aria-pressed={kind === k} onClick={() => pickKind(k)}>
              {k}
            </button>
          ))}
        </div>
        {kind === "其他周邊" ? (
          <div className="field-sub field-sub-wide">
            <label className="sr-only" htmlFor={`${id}-kind-note`}>
              是什麼周邊
            </label>
            <input
              id={`${id}-kind-note`}
              className="input"
              placeholder="例如：手環、貼紙、票根"
              value={kindNote}
              onChange={(e) => setKindNote(e.target.value)}
            />
          </div>
        ) : null}
        {errors.kind ? <p className="field-error">{errors.kind}</p> : null}
      </div>

      {kind && pickedArtists.length ? (
        <div className="field" data-testid="where">
          <span className="field-label" id={`${id}-where`}>
            屬於哪裡
          </span>
          {record ? (
            <div className="picks" role="group" aria-labelledby={`${id}-where`} data-testid="where-record">
              {seriesBtns(ofKinds("album", "ep", "single"))}
              {unsureBtn}
              <SubmitSeries
                artists={pickedArtists}
                label="新增一個系列"
                kinds={["album", "ep", "single"]}
                testid="new-series-record"
                onCreated={addCreated}
                onPending={addPending}
              />
            </div>
          ) : (
            <>
              <div className="where-group" data-testid="where-tour">
                <span className="where-title" id={`${id}-where-tour`}>
                  演唱會／巡迴
                </span>
                <div className="picks" role="group" aria-labelledby={`${id}-where-tour`}>
                  {seriesBtns(ofKinds("tour"))}
                  <SubmitSeries
                    artists={pickedArtists}
                    label="新增一場演唱會／巡迴"
                    fixedKind="tour"
                    testid="new-tour"
                    onCreated={addCreated}
                    onPending={addPending}
                  />
                </div>
              </div>
              <div className="where-group" data-testid="where-album">
                <span className="where-title" id={`${id}-where-album`}>
                  隨專輯發行的周邊
                </span>
                <div className="picks" role="group" aria-labelledby={`${id}-where-album`}>
                  {seriesBtns(ofKinds("album", "ep", "single"))}
                  {ofKinds("album", "ep", "single").length ? null : <span className="sub">還沒有專輯</span>}
                </div>
              </div>
              <div className="where-group" data-testid="where-brand">
                <span className="where-title" id={`${id}-where-brand`}>
                  藝人自有品牌或周邊
                </span>
                <div className="picks" role="group" aria-labelledby={`${id}-where-brand`}>
                  {seriesBtns(ofKinds("brand"))}
                  {miscOptions.map((m) => whereBtn(m.key, m.label, "misc"))}
                  <SubmitSeries
                    artists={pickedArtists}
                    label="新增一個系列"
                    defaultKind="brand"
                    testid="new-series"
                    onCreated={addCreated}
                    onPending={addPending}
                  />
                </div>
              </div>
              <div className="picks where-unsure" role="group" aria-label="不確定">
                {unsureBtn}
              </div>
            </>
          )}
          {pendingSeries && (where === "unsure" || !where) ? (
            <p className="sub" role="status" data-testid="pending-series-note">
              「{pendingSeries.title}」送出審核了，這則先放在「不確定」，通過後會自動改到新系列
            </p>
          ) : null}
        </div>
      ) : null}

      {series && kind && sameKind.length > 1 ? (
        <div className="field">
          <span className="field-label" id={`${id}-item`}>
            哪一個{kind}
          </span>
          <div className="picks" role="group" aria-labelledby={`${id}-item`} data-testid="pick-item">
            {sameKind.map((it) => (
              <button
                key={it.id}
                type="button"
                className="pick"
                aria-pressed={itemPick === it.id}
                onClick={() => {
                  setItemPick(itemPick === it.id ? null : it.id);
                  setVersionPick("unsure");
                }}
              >
                {it.versions[0]?.edition ?? it.id}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {series && item ? (
        <div className="field">
          <span className="field-label" id={`${id}-version`}>
            版本
          </span>
          <div className="picks" role="group" aria-labelledby={`${id}-version`} data-testid="pick-version">
            {item.versions.map((v) => (
              <button
                key={v.id}
                type="button"
                className="pick"
                aria-pressed={versionPick === v.id}
                onClick={() => setVersionPick(v.id)}
              >
                {v.edition}
              </button>
            ))}
            <button type="button" className="pick" aria-pressed={versionPick === "unsure"} onClick={() => setVersionPick("unsure")}>
              不確定
            </button>
            <SubmitNew type="version" parent={`${series.key}#${item.id}`} label="這裡沒有，我要新增" />
          </div>
        </div>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor={`${id}-story`}>
          想說的話 <span className="opt">選填</span>
        </label>
        <textarea id={`${id}-story`} className="input textarea" rows={4} value={story} onChange={(e) => setStory(e.target.value)} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-tags`}>
          其他標籤 <span className="opt">選填</span>
        </label>
        <input id={`${id}-tags`} className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>

      <div className="field">
        <span className="field-label" id={`${id}-sale`}>
          要不要賣
        </span>
        {sold ? (
          <p className="sub" data-testid="sale-sold-note">
            已成交，出售狀態與價格不能改
          </p>
        ) : !acc.geo.canTrade ? (
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
            <button key={k} type="button" aria-pressed={saleState === k} onClick={() => setSaleState(k)}>
              {label}
            </button>
          ))}
        </div>
        )}
        {!sold && acc.geo.canTrade && saleState === "sale" ? (
          <div className="field-sub">
            <MoneyInput id={`${id}-price`} value={price} onChange={setPrice} label="定價" />
            {errors.price ? <p className="field-error">{errors.price}</p> : null}
          </div>
        ) : null}
      </div>

      {errors.form ? (
        <p className="field-error" role="alert">
          {errors.form}
        </p>
      ) : null}
      <div className="form-foot">
        {acc.status === "anon" ? <span className="sub">發布前會請你登入</span> : null}
        {edit ? (
          <button type="button" className="btn btn-line" onClick={() => router.push(`/share/${edit.n}`)} disabled={busy}>
            取消
          </button>
        ) : null}
        <button type="submit" className="btn btn-p" disabled={busy || picker.pending > 0} data-testid="share-submit">
          {busy ? (edit ? "儲存中…" : "發布中…") : edit ? "儲存" : "發布"}
        </button>
      </div>
    </form>
  );
}
