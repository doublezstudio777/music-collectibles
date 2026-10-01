"use client";

// 合集照片＋照片上的號碼標記（2026-10-01）。照片照原比例顯示（不裁成正方形），標記位置是照片寬高的比例，
// 所以號碼不管螢幕多寬都停在同一個地方。單則頁顯示用；發文表單另外傳 onPlace，點照片就在那裡放標記。

export type Pin = { n: number; x: number; y: number; key: string };

export function CollectionPhoto({
  src,
  w,
  h,
  alt,
  pins,
  active,
  onPin,
  onPlace,
  placing = false,
  onError,
}: {
  src: string;
  w: number;
  h: number;
  alt: string;
  pins: Pin[];
  /** 目前選到的標記（號碼反白） */
  active?: string | null;
  onPin?: (key: string) => void;
  /** 表單：點照片放標記（x、y 是 0～1） */
  onPlace?: (x: number, y: number) => void;
  placing?: boolean;
  onError?: () => void;
}) {
  const ratio = w > 0 && h > 0 ? `${w} / ${h}` : undefined;
  return (
    <div
      className={`cphoto${placing ? " is-placing" : ""}`}
      style={ratio ? { aspectRatio: ratio } : undefined}
      data-testid="cphoto"
      onClick={(e) => {
        if (!onPlace || !placing) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        onPlace(x, y);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 要照原比例、跟標記同一個座標系，不用 next/image 的 fill */}
      <img src={src} alt={alt} draggable={false} onError={onError} />
      {pins.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`cpin${active === p.key ? " is-on" : ""}`}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          aria-label={`第 ${p.n} 張`}
          aria-pressed={active === p.key}
          data-testid="cpin"
          data-key={p.key}
          onClick={(e) => {
            e.stopPropagation();
            onPin?.(p.key);
          }}
        >
          {p.n}
        </button>
      ))}
    </div>
  );
}
