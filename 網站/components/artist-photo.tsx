import type { ArtistPhoto } from "@/lib/server/artist-photos";

/**
 * 藝人頁上方的藝人照片（2026-09-28）：照片下方標示攝影者、授權、來源。只有使用中的照片才會傳進來。
 * 2026-10-03：維基的藝人照片多半是直式人像，照片一律維持直式。直式原圖放進 3:4 的框、上緣對齊（臉在上半）；
 * 橫式原圖（少數）照原比例整張顯示、不裁人臉，框的高度就跟著變矮。寬度由 CSS 決定（桌機 210px，手機佔左欄）
 */
export function ArtistPhotoFigure({ photo, name }: { photo: ArtistPhoto; name: string }) {
  const w = photo.width || 600;
  const h = photo.height || 800;
  const landscape = w > h;
  return (
    <figure className={landscape ? "artist-photo is-landscape" : "artist-photo is-portrait"} data-testid="artist-photo" data-orient={landscape ? "landscape" : "portrait"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={`${name}照片`} width={w} height={h} decoding="async" />
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

/** 沒有照片的藝人：左側放直式佔位（黑白橘的唱片圖形），右欄內容照舊，不留空白（2026-10-03） */
export function ArtistPhotoPlaceholder() {
  return (
    <div className="artist-photo-ph" role="img" aria-label="還沒有藝人照片" data-testid="artist-photo-ph">
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle cx="60" cy="60" r="50" fill="#FFFFFF" stroke="#111111" strokeWidth="5" />
        <circle cx="60" cy="60" r="30" fill="none" stroke="#111111" strokeWidth="2" />
        <circle cx="60" cy="60" r="17" fill="#FF6A00" stroke="#111111" strokeWidth="4" />
        <circle cx="60" cy="60" r="4" fill="#FFFFFF" stroke="#111111" strokeWidth="3" />
      </svg>
    </div>
  );
}
