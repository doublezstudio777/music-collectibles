"use client";

import Image from "next/image";
import Link from "next/link";
import { linkHasFakes, priceText, shareHref, tagHref, userHref, type Sale, type ShareView } from "@/lib/data";
import { useAppState, useLock, type Lock } from "@/lib/state";
import { LikeButton } from "@/components/like-button";

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

export function Photo({
  share,
  sizes,
  sale,
  lock = null,
}: {
  share: ShareView;
  sizes: string;
  sale?: Sale;
  lock?: Lock | null;
}) {
  return (
    <span className="photo">
      <span className={`photo-fill ph-${share.n % 4}`}>
        {share.image ? (
          <Image src={share.image} alt={share.what} fill sizes={sizes} unoptimized={share.image.startsWith("data:")} />
        ) : null}
        {!share.image && share.kind ? <b className="photo-kind">{share.kind}</b> : null}
      </span>
      <Flags lock={lock} fake={linkHasFakes(share.link)} />
      {sale ? <SaleSlots sale={sale} locked={Boolean(lock)} /> : null}
    </span>
  );
}

export function TagList({ about, tags }: { about: string[]; tags: string[] }) {
  if (about.length + tags.length === 0) return null;
  return (
    <ul className="tags">
      {about.map((t) => (
        <li key={`a-${t}`}>
          <Link className="tag tag-about" href={tagHref(t)}>
            {t}
          </Link>
        </li>
      ))}
      {tags.map((t) => (
        <li key={`t-${t}`}>
          <Link className="tag" href={tagHref(t)}>
            {t}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ShareCard({ share }: { share: ShareView }) {
  const { saleOf } = useAppState();
  const sale = saleOf(share);
  const lock = useLock(share);
  return (
    <article
      className={sale.state === "sold" ? "card is-sold" : "card"}
      data-sale={sale.state}
      data-locked={lock ? "true" : undefined}
      data-fake={linkHasFakes(share.link) ? "true" : undefined}
    >
      <Link href={shareHref(share.n)} className="card-photo" tabIndex={-1} aria-hidden="true">
        <Photo share={share} sale={sale} lock={lock} sizes="(max-width: 1000px) 50vw, 380px" />
      </Link>
      <h3 className="card-title">
        <Link href={shareHref(share.n)}>{share.what}</Link>
      </h3>
      <TagList about={share.about} tags={share.tags} />
      <footer className="card-foot">
        <Link className="who" href={userHref(share.author.handle)}>
          <span className="ava ava-sm" aria-hidden="true">
            {share.author.initials}
          </span>
          <span>{share.author.name}</span>
        </Link>
        <span className="when">{share.time}</span>
        <LikeButton n={share.n} base={share.likes} />
      </footer>
    </article>
  );
}
