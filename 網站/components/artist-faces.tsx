"use client";

// 藝人圓圈（2026-09-29）：首頁最上方一排、藝人目錄格狀共用。
// 圓圈照片由 Catalog.artistFaces 決定（藝人使用中照片 → 最新一則沒被鎖定的收藏縮圖 → 沒有圖），這裡只負責畫。
// 首頁整頁快取：伺服器輸出依收藏數排，已追蹤的藝人在瀏覽器端讀到 /api/me 後才移到前面，快取的 HTML 不因人而異。
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { artistHref } from "@/lib/data";
import { useAppState } from "@/lib/state";
import type { ArtistFace } from "@/lib/catalog";

/** 首頁一排最多幾位（第 25 格是「全部藝人」） */
export const ROW_MAX = 24;

export function FaceImg({ face, eager = false }: { face: ArtistFace; eager?: boolean }) {
  return face.img ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`face-img face-${face.imgFrom ?? "share"}`} src={face.img} alt="" loading={eager ? "eager" : "lazy"} decoding="async" data-face={face.imgFrom ?? "share"} />
  ) : (
    <span className="face-img face-none" aria-hidden="true" data-face="none">
      {Array.from(face.name)[0] ?? "?"}
    </span>
  );
}

/** 首頁：標語之下、排序分頁籤之上，不論有沒有追蹤藝人都出現 */
export function ArtistRow({ faces }: { faces: ArtistFace[] }) {
  const { state } = useAppState();
  const followed = new Set(state.ready ? state.follows : []);
  const list = (followed.size ? [...faces].sort((a, b) => Number(followed.has(b.slug)) - Number(followed.has(a.slug))) : faces).slice(
    0,
    ROW_MAX,
  );
  return (
    <nav className="faces" aria-label="藝人" data-testid="artist-row">
      <ul className="faces-row">
        {list.map((f, i) => (
          <li key={f.slug} className="face" data-artist={f.slug}>
            <Link className="face-link" href={artistHref(f.slug)}>
              <FaceImg face={f} eager={i < 12} />
              <span className="face-name">{f.name}</span>
            </Link>
          </li>
        ))}
        <li className="face face-all">
          <Link className="face-link" href="/artists" data-testid="artist-row-all">
            <span className="face-img face-more" aria-hidden="true">
              <ArrowRight />
            </span>
            <span className="face-name">全部藝人</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
