import type { ArtistPhoto } from "@/lib/server/artist-photos";

/** 藝人頁上方的藝人照片（2026-09-28）：照片下方標示攝影者、授權、來源。只有使用中的照片才會傳進來 */
export function ArtistPhotoFigure({ photo, name }: { photo: ArtistPhoto; name: string }) {
  const w = photo.width || 800;
  const h = photo.height || 1000;
  // 放進 240×280 的框，不放大；說明文字跟著照片寬度換行
  const scale = Math.min(240 / w, 280 / h, 1);
  const dw = Math.round(w * scale);
  return (
    <figure className="artist-photo" style={{ width: dw }} data-testid="artist-photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={name} width={w} height={h} decoding="async" />
      <figcaption className="artist-photo-credit" data-testid="artist-photo-credit">
        攝影：
        {photo.authorUrl ? (
          <a className="link" href={photo.authorUrl} {...(photo.authorUrl.startsWith("/") ? {} : { target: "_blank", rel: "noopener" })}>
            {photo.author}
          </a>
        ) : (
          photo.author || "不詳"
        )}
        <span className="dot" aria-hidden="true">
          ·
        </span>
        {photo.licenseUrl ? (
          <a className="link lic" href={photo.licenseUrl} target="_blank" rel="license noopener">
            {photo.license}
          </a>
        ) : (
          <span className="lic">{photo.license}</span>
        )}
        {photo.sourceUrl ? (
          <>
            <span className="dot" aria-hidden="true">
              ·
            </span>
            <a className="link" href={photo.sourceUrl} target="_blank" rel="noopener">
              維基共享資源
            </a>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}
