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
import { uploadImage } from "@/lib/image";
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

type FormArtist = FormOptions["artists"][number];
/** 藝人一多（金曲金音名單三百多位）全部攤開太長：一次最多列這麼多，其餘靠分類與打字搜尋 */
const ARTIST_CAP = 30;
type FormSeries = FormOptions["series"][number];

/**
 * 「這裡沒有，我要新增」：送出後是待審核，管理員在後台核准才出現。
 * type＝artist｜series｜item｜version，parent 是上一層的鍵。
 */
function SubmitNew({ type, parent, label }: { type: "artist" | "series" | "item" | "version"; parent?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  if (done) return <span className="sub" role="status">已送出，等管理員審核</span>;
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
            { k: "year", label: "年份", ph: "2024" },
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
    if (type === "series") body.artist = parent;
    if (type === "item") {
      body.seriesKey = parent;
      if (!f.kind) {
        setError("點一個類型");
        return;
      }
    }
    if (type === "version") body.itemKey = parent;
    const r = await api("/api/catalog/submit", { body });
    if (r.ok) setDone(true);
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
  const artists = options.artists;
  const id = "share-form";
  const [photo, setPhoto] = useState<{ id: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [gender, setGender] = useState<ArtistGender | null>(null);
  const [region, setRegion] = useState<ArtistRegion | null>(null);
  const [about, setAbout] = useState<string[]>([]);
  const [aboutDraft, setAboutDraft] = useState("");
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

  const resolveTagArtist = (t: string): FormArtist | undefined => {
    const q = norm(t);
    return artists.find((a) => norm(a.name) === q || a.aliases.some((x) => norm(x) === q));
  };

  const shownArtists = artists.filter((a) => {
    if (!gender && !region) return true;
    if (a.kind !== "藝人") return false;
    return (!gender || a.gender === gender) && (!region || a.region === region);
  });

  const q = aboutDraft.trim().toLowerCase();
  const suggestions = q
    ? artists.filter(
        (a) =>
          !about.includes(a.name) &&
          (a.name.toLowerCase().includes(q) || a.aliases.some((x) => x.toLowerCase().includes(q))),
      )
    : [];

  const toggleAbout = (name: string) => {
    setAbout(about.includes(name) ? about.filter((x) => x !== name) : [...about, name]);
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

  /** 選照片就壓縮上傳（要登入）；容量滿或暫停時顯示「上傳暫停」 */
  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    whenLoggedIn("登入後才能炫收藏", async () => {
      setUploading(true);
      setErrors((x) => ({ ...x, photo: "" }));
      try {
        const r = await uploadImage(file, "share");
        if (r.ok) setPhoto({ id: r.data.id, preview: r.data.thumbUrl });
        else if (r.error.code === "STORAGE_FULL" || r.error.code === "UPLOAD_PAUSED") setPaused(true);
        else setErrors((x) => ({ ...x, photo: r.error.message }));
      } catch {
        setErrors((x) => ({ ...x, photo: "這個檔案讀不出來，換一張" }));
      }
      setUploading(false);
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pending = aboutDraft.trim() ? [...about, resolveTagArtist(aboutDraft)?.name ?? aboutDraft.trim()] : about;
    const next: Record<string, string> = {};
    if (!photo) next.photo = "放一張照片";
    if (pending.length === 0) next.about = "至少點一位";
    if (!effectiveKind) next.kind = series ? "點一個品項" : "點一個類型";
    if (!series && kind === "其他周邊" && !kindNote.trim()) next.kind = "寫一下是什麼周邊";
    const p = parsePrice(price);
    if (saleState === "sale" && !p) next.price = "填一個整數金額";
    setErrors(next);
    if (Object.keys(next).length || !effectiveKind) return;

    whenLoggedIn("登入後才能炫收藏", async () => {
      setBusy(true);
      const r = await api<{ n: number }>("/api/shares", {
        body: {
          photoIds: photo ? [photo.id] : [],
          about: Array.from(new Set(pending)),
          ...(series ? { seriesKey: series.key, itemId: item?.id, versionId: version?.id } : { kind, kindNote: kindNote.trim() }),
          story: story.trim(),
          tags: splitTags(tags),
          refPhoto: refOk,
          sale: saleState === "sale" ? { state: "sale", price: p } : { state: saleState },
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
        {paused ? (
          <p className="upload-paused" role="status" data-testid="upload-paused">
            上傳暫停
          </p>
        ) : (
          <label className={photo ? "drop has-photo" : "drop"} style={photo ? { backgroundImage: `url(${photo.preview})` } : undefined}>
            <input type="file" accept="image/*" className="sr-only" aria-labelledby={`${id}-photo`} onChange={onPhoto} disabled={uploading} />
            <span className="drop-text">{uploading ? "上傳中…" : photo ? "換一張" : "＋ 加照片"}</span>
          </label>
        )}
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
          {shownArtists.slice(0, ARTIST_CAP).map((a) => (
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
          {shownArtists.length > ARTIST_CAP ? <span className="sub">還有 {shownArtists.length - ARTIST_CAP} 位，用分類縮小或打字搜尋</span> : null}
          <SubmitNew type="artist" label="找不到藝人，我要新增" />
        </div>
        {about.filter((t) => !shownArtists.slice(0, ARTIST_CAP).some((a) => a.name === t)).length ? (
          <div className="chip-row">
            {about
              .filter((t) => !shownArtists.slice(0, ARTIST_CAP).some((a) => a.name === t))
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
                <button type="button" onClick={() => addAbout(a.name)}>
                  <b>{a.name}</b>
                  <span>{a.kind}</span>
                </button>
              </li>
            ))}
            {q && !resolveTagArtist(aboutDraft) ? (
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
        {saleState === "sale" ? (
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
        <button type="submit" className="btn btn-p" disabled={busy || uploading}>
          發布
        </button>
      </div>
    </form>
  );
}
