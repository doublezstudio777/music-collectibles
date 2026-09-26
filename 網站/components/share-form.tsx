"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  artists,
  CURRENT_USER,
  GENDER_LABEL,
  getUser,
  itemHref,
  KINDS,
  mainSeriesOf,
  REGION_LABEL,
  resolveTagArtist,
  seriesHref,
  seriesKey,
  versionHref,
  type ArtistGender,
  type ArtistRegion,
  type Kind,
  type Sale,
  type SaleState,
  type Series,
} from "@/lib/data";
import { shrink } from "@/lib/image";
import { addMyShare } from "@/lib/state";
import { MoneyInput, parsePrice } from "@/components/share-detail";
import { NextPhase } from "@/components/next-phase";

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

export function ShareForm() {
  const router = useRouter();
  const id = "share-form";
  const [photo, setPhoto] = useState<string | null>(null);
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
  const seriesOptions: Series[] = [];
  about.forEach((name) => {
    const a = resolveTagArtist(name);
    if (!a) return;
    mainSeriesOf(a.slug).forEach((w) => {
      if (!seriesOptions.some((x) => seriesKey(x) === seriesKey(w))) seriesOptions.push(w);
    });
  });
  const series = seriesOptions.find((w) => seriesKey(w) === seriesPick);
  const item = series?.items.find((i) => i.id === itemPick);
  const version = item?.versions.find((v) => v.id === versionPick);
  const effectiveKind: Kind | null = item ? item.kind : kind;

  const pickSeries = (k: string) => {
    setSeriesPick(seriesPick === k ? null : k);
    setItemPick(null);
    setVersionPick("unsure");
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await shrink(file));
    } catch {
      setErrors((x) => ({ ...x, photo: "這個檔案讀不出來，換一張" }));
    }
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

    setBusy(true);
    const me = getUser(CURRENT_USER);
    const names = Array.from(new Set(pending));
    const what = series
      ? [series.title, effectiveKind, version?.edition].filter(Boolean).join(" ")
      : `${names.join("、")} ${kind === "其他周邊" ? kindNote.trim() : effectiveKind}`;
    const n = addMyShare({
      what,
      kind: effectiveKind,
      ...(!series && kind === "其他周邊" && kindNote.trim() ? { kindNote: kindNote.trim() } : {}),
      ...(refOk ? { refPhoto: true } : {}),
      story: story.trim(),
      time: "剛剛",
      about: names,
      tags: splitTags(tags),
      likes: 0,
      color: "",
      sale: (saleState === "sale" ? { state: "sale", price: p ?? 0 } : { state: saleState }) as Sale,
      image: photo ?? undefined,
      author: { handle: CURRENT_USER, name: me?.name ?? CURRENT_USER, initials: me?.initials ?? "我" },
      link: series
        ? {
            href: item ? (version ? versionHref(series, item, version) : itemHref(series, item)) : seriesHref(series),
            label: [series.title, item?.kind, version?.edition].filter(Boolean).join(" › "),
            seriesKey: seriesKey(series),
            itemId: item?.id,
            versionId: version?.id,
          }
        : undefined,
    });
    if (n === null) {
      setBusy(false);
      setErrors({ photo: "瀏覽器空間不夠，換一張小一點的照片" });
      return;
    }
    router.push(`/share/${n}`);
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <span className="field-label" id={`${id}-photo`}>
          照片
        </span>
        <label className={photo ? "drop has-photo" : "drop"} style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
          <input type="file" accept="image/*" className="sr-only" aria-labelledby={`${id}-photo`} onChange={onPhoto} />
          <span className="drop-text">{photo ? "換一張" : "＋ 加照片"}</span>
        </label>
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
        </div>
        {about.filter((t) => !shownArtists.some((a) => a.name === t)).length ? (
          <div className="chip-row">
            {about
              .filter((t) => !shownArtists.some((a) => a.name === t))
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
              <button
                key={seriesKey(w)}
                type="button"
                className="pick"
                aria-pressed={seriesPick === seriesKey(w)}
                onClick={() => pickSeries(seriesKey(w))}
              >
                {w.name}
              </button>
            ))}
            <NextPhase label="這裡沒有，我要新增" className="pick pick-add" />
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
            <NextPhase label="這裡沒有，我要新增" className="pick pick-add" />
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

      <div className="form-foot">
        <button type="submit" className="btn btn-p" disabled={busy}>
          發布
        </button>
      </div>
    </form>
  );
}
