"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { artists, CURRENT_USER, getUser, resolveTagArtist } from "@/lib/data";
import { addMyShare } from "@/lib/state";

/** 縮到長邊 1000px、JPEG 0.8，才塞得進 localStorage */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function splitTags(s: string) {
  return s
    .split(/[,，、\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function ShareForm() {
  const router = useRouter();
  const id = "share-form";
  const [photo, setPhoto] = useState<string | null>(null);
  const [what, setWhat] = useState("");
  const [about, setAbout] = useState<string[]>([]);
  const [aboutDraft, setAboutDraft] = useState("");
  const [story, setStory] = useState("");
  const [tags, setTags] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const q = aboutDraft.trim().toLowerCase();
  const suggestions = q
    ? artists.filter(
        (a) =>
          !about.includes(a.name) &&
          (a.name.toLowerCase().includes(q) || a.aliases.some((x) => x.toLowerCase().includes(q))),
      )
    : [];

  const addAbout = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const name = resolveTagArtist(t)?.name ?? t;
    if (!about.includes(name)) setAbout([...about, name]);
    setAboutDraft("");
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
    if (!what.trim()) next.what = "寫這是什麼東西";
    if (pending.length === 0) next.about = "至少一個";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const me = getUser(CURRENT_USER);
    const n = addMyShare({
      what: what.trim(),
      kind: "",
      story: story.trim(),
      time: "剛剛",
      about: Array.from(new Set(pending)),
      tags: splitTags(tags),
      likes: 0,
      color: "#E9EDF2",
      image: photo ?? undefined,
      author: { handle: CURRENT_USER, name: me?.name ?? CURRENT_USER, initials: me?.initials ?? "我" },
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
        <label className="field-label" htmlFor={`${id}-what`}>
          這是什麼東西
        </label>
        <input
          id={`${id}-what`}
          className="input"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          aria-invalid={Boolean(errors.what)}
        />
        {errors.what ? <p className="field-error">{errors.what}</p> : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-about`}>
          跟誰有關
        </label>
        <div className="chip-input">
          {about.map((t) => (
            <span className="chip" key={t}>
              {t}
              <button type="button" aria-label={`移除 ${t}`} onClick={() => setAbout(about.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
          <input
            id={`${id}-about`}
            className="chip-field"
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
        </div>
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

      <div className="form-foot">
        <button type="submit" className="btn btn-p" disabled={busy}>
          發布
        </button>
      </div>
    </form>
  );
}
