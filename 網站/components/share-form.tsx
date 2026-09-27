"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  GENDER_LABEL,
  KINDS,
  norm,
  REGION_LABEL,
  type ArtistGender,
  type ArtistRegion,
  type Kind,
  type SaleState,
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
 * 「這裡沒有，我要新增」：送出後是待審核，管理員在後台核准才出現。
 * type＝artist｜series｜item｜version，parent 是上一層的鍵。
 */
function SubmitNew({ type, parent, label }: { type: "artist" | "series" | "item" | "version"; parent?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<"" | "pending" | "approved">("");
  const [f, setF] = useState<Record<string, string>>({});
  const [noYear, setNoYear] = useState(false);
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
      : type === "series"
        ? [
            { k: "title", label: "系列名稱", ph: "例：夜行採集" },
            { k: "seriesType", label: "類型", ph: "專輯發行／巡迴演唱會" },
          ]
        : type === "item"
          ? [{ k: "edition", label: "版本名稱", ph: "一般版" }]
          : [
              { k: "edition", label: "版本名稱", ph: "首批、日版、再版…" },
              { k: "year", label: "年份" },
              { k: "catalog", label: "目錄號" },
            ];
  const send = async () => {
    const body: Record<string, unknown> = { type, ...f };
    if (type === "series") {
      body.artist = parent;
      body.year = noYear ? "" : (f.year ?? "").trim();
      if (!noYear && !/^\d{4}$/.test(body.year as string)) {
        setError("填發行年（西元四位數），或勾「不記得」");
        return;
      }
    }
    if (type === "item") {
      body.seriesKey = parent;
      if (!f.kind) {
        setError("點一個類型");
        return;
      }
    }
    if (type === "version") body.itemKey = parent;
    const r = await api<{ approved?: boolean }>("/api/catalog/submit", { body });
    if (r.ok) setDone(r.data.approved ? "approved" : "pending");
    else setError(r.error.message);
  };
  return (
    <div className="submit-new" data-testid={`submit-${type}`}>
      {type === "item" ? (
        <div className="picks" role="group" aria-label="類型">
          {KINDS.map((k) => (
            <button key={k} type="button" className="pick" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
              {k}
            </button>
          ))}
        </div>
      ) : null}
      {fields.map((x) => (
        <label key={x.k} className="submit-field">
          <span>{x.label}</span>
          <input className="input input-sm" placeholder={x.ph} value={f[x.k] ?? ""} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} />
        </label>
      ))}
      {type === "series" ? (
        <div className="submit-field submit-year">
          <label htmlFor="submit-series-year">發行年</label>
          <input
            id="submit-series-year"
            className="input input-sm"
            inputMode="numeric"
            maxLength={4}
            placeholder="2024"
            disabled={noYear}
            value={noYear ? "" : (f.year ?? "")}
            onChange={(e) => setF({ ...f, year: e.target.value })}
            data-testid="submit-series-year"
          />
          <label className="check-inline">
            <input type="checkbox" checked={noYear} onChange={(e) => setNoYear(e.target.checked)} data-testid="submit-series-noyear" />
            不記得
          </label>
        </div>
      ) : null}
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

export function ShareForm({ options }: { options: FormOptions }) {
  const router = useRouter();
  const acc = useAccount();
  const id = "share-form";
  const [paused, setPaused] = useState(false);
  const picker = usePhotoPicker([], () => setPaused(true));
  const [gender, setGender] = useState<ArtistGender | null>(null);
  const [region, setRegion] = useState<ArtistRegion | null>(null);
  const [about, setAbout] = useState<string[]>([]);
  const [aboutDraft, setAboutDraft] = useState("");
  /** 「更多」按鈕：預設只列 options.defaultArtists（最多 10 位），按下去才加進 options.moreArtists */
  const [expanded, setExpanded] = useState(false);
  /** 打字搜尋結果（/api/artists/search），累積起來讓選過的藝人之後也查得到 slug（拼系列用） */
  const [found, setFound] = useState<FormArtist[]>([]);
  const [seriesPick, setSeriesPick] = useState<string | null>(null);
  const [itemPick, setItemPick] = useState<string | null>(null);
  const [versionPick, setVersionPick] = useState<string>("unsure");
  const [kind, setKind] = useState<Kind | null>(null);
  const [kindNote, setKindNote] = useState("");
  const [story, setStory] = useState("");
  const [tags, setTags] = useState("");
  const [refOk, setRefOk] = useState(false);
  const [saleState, setSaleState] = useState<SaleState>("share");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ paused: boolean }>("/api/uploads").then((r) => r.ok && setPaused(r.data.paused));
  }, []);

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

  /** 選到的藝人的系列（共同署名兩邊都算，不重複） */
  const seriesOptions: FormSeries[] = [];
  const pickedArtists = about.map((n) => resolveTagArtist(n)).filter((a): a is FormArtist => Boolean(a));
  pickedArtists.forEach((a) => {
    options.series
      .filter((w) => w.credits.includes(a.slug))
      .forEach((w) => {
        if (!seriesOptions.some((x) => x.key === w.key)) seriesOptions.push(w);
      });
  });
  const series = seriesOptions.find((w) => w.key === seriesPick);
  const item = series?.items.find((i) => i.id === itemPick);
  const version = item?.versions.find((v) => v.id === versionPick);
  const effectiveKind: Kind | null = item ? (item.kind as Kind) : kind;

  const pickSeries = (k: string) => {
    setSeriesPick(seriesPick === k ? null : k);
    setItemPick(null);
    setVersionPick("unsure");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pending = aboutDraft.trim() ? [...about, resolveTagArtist(aboutDraft)?.name ?? aboutDraft.trim()] : about;
    const next: Record<string, string> = {};
    if (picker.items.length === 0) next.photo = "至少放一張照片";
    else if (picker.pending) next.photo = "照片還在上傳，等一下";
    else if (picker.failed) next.photo = "有照片沒傳上去，按重試或刪掉那張";
    if (pending.length === 0) next.about = "至少點一位";
    if (!effectiveKind) next.kind = series ? "點一個品項" : "點一個類型";
    if (!series && kind === "其他周邊" && !kindNote.trim()) next.kind = "寫一下是什麼周邊";
    const p = parsePrice(price);
    if (saleState === "sale" && !p) next.price = "填一個整數金額";
    setErrors(next);
    if (Object.keys(next).length || !effectiveKind) return;

    whenLoggedIn("登入後才能炫收藏", async () => {
      setBusy(true);
      // 分享預覽圖只替封面（第一張）畫；畫不出來不擋發文，og:image 會退回縮圖
      const cover = picker.items[0];
      if (cover?.id && acc.me?.handle) await uploadCoverOg(cover.id, cover.file ?? cover.url ?? "", acc.me.handle).catch(() => null);
      const r = await api<{ n: number }>("/api/shares", {
        body: {
          photoIds: picker.items.map((x) => x.id).filter(Boolean),
          about: Array.from(new Set(pending)),
          ...(series ? { seriesKey: series.key, itemId: item?.id, versionId: version?.id } : { kind, kindNote: kindNote.trim() }),
          story: story.trim(),
          tags: splitTags(tags),
          refPhoto: refOk,
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
    <form className="form" onSubmit={submit} noValidate>
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

      {about.some((t) => resolveTagArtist(t)) ? (
        <div className="field">
          <span className="field-label" id={`${id}-series`}>
            系列 <span className="opt">選填</span>
          </span>
          <div className="picks" role="group" aria-labelledby={`${id}-series`} data-testid="pick-series">
            {seriesOptions.map((w) => (
              <button key={w.key} type="button" className="pick" aria-pressed={seriesPick === w.key} onClick={() => pickSeries(w.key)}>
                {w.name}
              </button>
            ))}
            {pickedArtists.length ? <SubmitNew type="series" parent={pickedArtists[0].slug} label="這裡沒有，我要新增" /> : null}
          </div>
        </div>
      ) : null}

      <div className="field">
        <span className="field-label" id={`${id}-kind`}>
          是什麼東西
        </span>
        {series ? (
          <div className="picks" role="group" aria-labelledby={`${id}-kind`} data-testid="pick-item">
            {series.items.map((it) => (
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
                {it.kind}
              </button>
            ))}
            <SubmitNew type="item" parent={series.key} label="這裡沒有，我要新增" />
          </div>
        ) : (
          <>
            <div className="picks" role="group" aria-labelledby={`${id}-kind`} data-testid="pick-kind">
              {KINDS.map((k) => (
                <button key={k} type="button" className="pick" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
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
          </>
        )}
        {errors.kind ? <p className="field-error">{errors.kind}</p> : null}
      </div>

      {item ? (
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
            {series ? <SubmitNew type="version" parent={`${series.key}#${item.id}`} label="這裡沒有，我要新增" /> : null}
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

      <label className="check" htmlFor={`${id}-ref`}>
        <input id={`${id}-ref`} type="checkbox" checked={refOk} onChange={(e) => setRefOk(e.target.checked)} />
        <span>照片可當辨識參考</span>
      </label>
      <div className="field">
        <span className="field-label" id={`${id}-sale`}>
          要不要賣
        </span>
        {!acc.geo.canTrade ? (
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
        {acc.geo.canTrade && saleState === "sale" ? (
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
        <button type="submit" className="btn btn-p" disabled={busy || picker.pending > 0}>
          發布
        </button>
      </div>
    </form>
  );
}
