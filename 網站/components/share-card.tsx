"use client";

import Image from "next/image";
import Link from "next/link";
import { priceText, shareHref, tagHref, userHref, watermarkText, type Lock, type Sale, type ShareView } from "@/lib/data";
import { LikeButton } from "@/components/like-button";
import { LevelTag } from "@/components/level-tag";

/** 封面左下的狀態槽位：四種狀態同一個位子；被鎖時改成「交易暫停」 */
export function SaleSlots({ sale, locked = false }: { sale: Sale; locked?: boolean }) {
  if (sale.state === "share") return null;
  if (locked && sale.state !== "sold") {
    return (
      <span className="slots">
        <span className="slot slot-paused">交易暫停</span>
      </span>
    );
  }
  if (sale.state === "offer") {
    return (
      <span className="slots">
        <span className="slot slot-offer">開放出價</span>
      </span>
    );
  }
  if (sale.state === "sale") {
    return (
      <span className="slots">
        <span className="slot slot-price">{priceText(sale.price ?? 0)}</span>
      </span>
    );
  }
  const shown = sale.soldPrice ?? sale.price;
  return (
    <span className="slots">
      <span className="slot slot-sold">已售出</span>
      {shown ? <span className="slot slot-soldprice">{priceText(shown)}</span> : null}
    </span>
  );
}

/** 封面左上的警示：被鎖、有已知仿冒 */
export function Flags({ lock, fake }: { lock: Lock | null; fake: boolean }) {
  if (!lock && !fake) return null;
  return (
    <span className="flags">
      {lock ? <span className="flag flag-lock">{lock.level === "share" ? "疑似盜版" : lock.level === "item" ? "爭議品項" : "爭議版本"}</span> : null}
      {fake ? <span className="flag flag-fake">有已知仿冒</span> : null}
    </span>
  );
}

/**
 * 浮水印：顯示時用 CSS 疊在照片上，不燒進檔案（檔案原樣，改站名全站一起變）。
 * 角落一個；large 另外在中間疊一個斜的淡字（單則頁、大圖），裁掉角落也還在。
 */
export function Watermark({ handle, large = false }: { handle: string; large?: boolean }) {
  if (!handle) return null;
  const text = watermarkText(handle);
  return (
    <>
      <span className="wm" aria-hidden="true" data-testid="watermark">
        {text}
      </span>
      {large ? (
        <span className="wm-center" aria-hidden="true">
          {text}
        </span>
      ) : null}
    </>
  );
}

export function Photo({
  share,
  sizes,
  sale,
  lock = null,
  small = false,
  src: override,
  large = false,
  hires = false,
  under,
  onError,
}: {
  share: ShareView;
  sizes: string;
  sale?: Sale;
  lock?: Lock | null;
  /** 卡片、私訊小圖用縮圖 */
  small?: boolean;
  /** 指定圖檔（單則頁：沒登入給縮圖、登入換大圖） */
  src?: string;
  /** 浮水印多疊一個中間的 */
  large?: boolean;
  /** 單則頁登入者：這張是高清大圖（驗收用 data-hires） */
  hires?: boolean;
  /** 高清圖載入前先墊在底下的縮圖（換圖時不會空白一下） */
  under?: string;
  onError?: () => void;
}) {
  // 公開頁面一律先給縮圖（大圖要登入，/img/ 伺服器端檢查）
  const src = override ?? (small ? (share.thumb ?? share.image) : (share.thumb ?? share.image));
  return (
    <span className="photo">
      <span className={`photo-fill ph-${share.n % 4}`}>
        {src && under && under !== src ? <Image src={under} alt="" aria-hidden="true" fill sizes={sizes} unoptimized={under.startsWith("/img/")} /> : null}
        {src ? (
          <Image
            key={src}
            src={src}
            alt={share.what}
            fill
            sizes={sizes}
            unoptimized={src.startsWith("/img/")}
            onError={onError}
            data-hires={hires ? "1" : undefined}
            {...(hires ? { loading: "eager" as const } : {})}
          />
        ) : null}
        {!src && share.kind ? <b className="photo-kind">{share.kind}</b> : null}
        {src ? <Watermark handle={share.author.handle} large={large} /> : null}
      </span>
      <Flags lock={lock} fake={share.hasFakes} />
      {sale ? <SaleSlots sale={sale} locked={Boolean(lock)} /> : null}
    </span>
  );
}

/** 對應到公開藝人頁的標籤（links 裡有的）直接連藝人頁，其餘連標籤頁 */
export function TagList({ about, tags, links }: { about: string[]; tags: string[]; links?: Record<string, string> }) {
  if (about.length + tags.length === 0) return null;
  const href = (t: string) => links?.[t] ?? tagHref(t);
  return (
    <ul className="tags">
      {about.map((t) => (
        <li key={`a-${t}`}>
          <Link className="tag tag-about" href={href(t)}>
            {t}
          </Link>
        </li>
      ))}
      {tags.map((t) => (
        <li key={`t-${t}`}>
          <Link className="tag" href={href(t)}>
            {t}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ShareCard({ share }: { share: ShareView }) {
  const sale = share.sale;
  const lock = share.lock;
  return (
    <article
      className={sale.state === "sold" ? "card is-sold" : "card"}
      data-sale={sale.state}
      data-locked={lock ? "true" : undefined}
      data-fake={share.hasFakes ? "true" : undefined}
    >
      <Link href={shareHref(share.n)} className="card-photo" tabIndex={-1} aria-hidden="true">
        <Photo share={share} sale={sale} lock={lock} small sizes="(max-width: 1000px) 50vw, 380px" />
      </Link>
      <h3 className="card-title">
        <Link href={shareHref(share.n)}>{share.what}</Link>
      </h3>
      <TagList about={share.about} tags={share.tags} links={share.tagLinks} />
      <footer className="card-foot">
        <Link className="who" href={userHref(share.author.handle)}>
          <span className="ava ava-sm" aria-hidden="true">
            {share.author.initials}
          </span>
          <span className="who-name">{share.author.name}</span>
        </Link>
        <LevelTag badge={share.author.badge} card />
        <span className="when">{share.time}</span>
        <LikeButton n={share.n} base={share.likes} />
      </footer>
    </article>
  );
}
