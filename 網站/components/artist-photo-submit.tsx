"use client";

import { useRef, useState } from "react";
import Link from "@/components/link";
import { api, useAccount, whenLoggedIn } from "@/lib/account";
import { prepareImage } from "@/lib/image";
import { PHOTO_LICENSE_URL, SITE_NAME } from "@/lib/data";

/**
 * 藝人頁「投稿藝人照片」（2026-09-28）。要登入；必勾本人拍攝與 CC BY-NC-ND 4.0 授權（2026-09-30 前是 CC BY-SA 4.0）；拍攝場合選填。
 * 照片在瀏覽器壓縮（規格同收藏照片：主圖長邊 1600、縮圖 480），投稿不公開，管理員設為使用中才會出現在藝人頁。
 */
export function ArtistPhotoSubmit({ slug, name }: { slug: string; name: string }) {
  const { status, me } = useAccount();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [own, setOwn] = useState(false);
  const [lic, setLic] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const start = () => whenLoggedIn("登入後才能投稿", () => setOpen(true));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!file) return setError("選一張照片");
    if (!own || !lic) return setError("兩項都要勾選才能投稿");
    setBusy(true);
    try {
      const { main, thumb } = await prepareImage(file);
      const form = new FormData();
      form.append("artist", slug);
      form.append("image", main, `photo.${main.type === "image/webp" ? "webp" : "jpg"}`);
      form.append("thumb", thumb, `thumb.${thumb.type === "image/webp" ? "webp" : "jpg"}`);
      form.append("own", "1");
      form.append("license", "1");
      form.append("occasion", occasion);
      form.append("date", date);
      const r = await api<{ id: number }>("/api/artist-photos", { body: form });
      if (!r.ok) {
        setError(r.error.code === "STORAGE_FULL" || r.error.code === "UPLOAD_PAUSED" ? "上傳暫停" : r.error.message);
        return;
      }
      setDone(true);
      setFile(null);
      setOwn(false);
      setLic(false);
      setOccasion("");
      setDate("");
      if (input.current) input.current.value = "";
    } catch {
      setError("這張照片讀不出來，換一張再試");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn-text artist-photo-entry" onClick={start} data-testid="artist-photo-entry">
        投稿藝人照片
      </button>
    );
  }
  const unverified = status === "user" && me && !me.verified;
  return (
    <form className="report-form artist-photo-form" onSubmit={submit} data-testid="artist-photo-form">
      <b>投稿 {name} 的照片</b>
      {done ? (
        <p className="report-done" role="status" data-testid="artist-photo-done">
          已送出，管理員選用後會出現在藝人頁。
        </p>
      ) : null}
      {unverified ? <p className="field-error">驗證 Email 後才能投稿</p> : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setDone(false);
        }}
        aria-label="照片"
        data-testid="artist-photo-file"
      />
      <label className="check">
        <input type="checkbox" checked={own} onChange={(e) => {
            setOwn(e.target.checked);
            setError("");
          }} data-testid="artist-photo-own" />
        <span>照片是我本人拍攝</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={lic} onChange={(e) => {
            setLic(e.target.checked);
            setError("");
          }} data-testid="artist-photo-license" />
        <span data-testid="artist-photo-license-text">
          同意以{" "}
          <a className="link" href={PHOTO_LICENSE_URL} target="_blank" rel="license noopener">
            CC BY-NC-ND 4.0
          </a>{" "}
          授權：可分享，但須標示原拍攝者與{SITE_NAME}出處、不得商業使用、不得修改。這項授權投稿後無法撤回
        </span>
      </label>
      <div className="artist-photo-occasion">
        <input
          className="input input-sm"
          value={occasion}
          maxLength={100}
          onChange={(e) => setOccasion(e.target.value)}
          placeholder="演出名稱（選填）"
          aria-label="演出名稱"
          data-testid="artist-photo-occasion"
        />
        <input className="input input-sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="拍攝日期" data-testid="artist-photo-date" />
      </div>
      <p className="sub">
        只收公開演出拍的照片。規則見
        <Link className="link" href="/terms#artist-photos">
          使用條款
        </Link>
      </p>
      {error ? (
        <p className="field-error" role="alert" data-testid="artist-photo-error">
          {error}
        </p>
      ) : null}
      <div className="settings-row">
        <button type="submit" className="btn btn-p" disabled={busy} data-testid="artist-photo-send">
          {busy ? "送出中…" : "送出"}
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </form>
  );
}
