"use client";

import Image from "next/image";
import Link from "next/link";
import { priceText, shareHref, tagHref, userHref, type Sale, type ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { LikeButton } from "@/components/like-button";

/** 封面左下的狀態槽位：四種狀態同一個位子 */
export function SaleSlots({ sale }: { sale: Sale }) {
  if (sale.state === "share") return null;
  if (sale.state === "offer") {
    return (
      <span className="slots">
        <span className="slot slot-offer">可出價</span>
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

export function Photo({ share, sizes, sale }: { share: ShareView; sizes: string; sale?: Sale }) {
  return (
    <span className="photo">
      <span className={`photo-fill ph-${share.n % 4}`}>
        {share.image ? (
          <Image src={share.image} alt={share.what} fill sizes={sizes} unoptimized={share.image.startsWith("data:")} />
        ) : null}
        {!share.image && share.kind ? <b className="photo-kind">{share.kind}</b> : null}
      </span>
      {sale ? <SaleSlots sale={sale} /> : null}
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
  return (
    <article className={sale.state === "sold" ? "card is-sold" : "card"} data-sale={sale.state}>
      <Link href={shareHref(share.n)} className="card-photo" tabIndex={-1} aria-hidden="true">
        <Photo share={share} sale={sale} sizes="(max-width: 1000px) 50vw, 380px" />
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
