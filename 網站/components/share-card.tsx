import Image from "next/image";
import Link from "next/link";
import { shareHref, tagHref, userHref, type ShareView } from "@/lib/data";
import { LikeButton } from "@/components/like-button";

export function Photo({ share, sizes }: { share: ShareView; sizes: string }) {
  return (
    <span className="photo" style={{ background: share.color }}>
      {share.image ? (
        <Image src={share.image} alt={share.what} fill sizes={sizes} unoptimized={share.image.startsWith("data:")} />
      ) : null}
      {!share.image && share.kind ? <b className="photo-kind">{share.kind}</b> : null}
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
  return (
    <article className="card">
      <Link href={shareHref(share.n)} className="card-photo" tabIndex={-1} aria-hidden="true">
        <Photo share={share} sizes="(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 380px" />
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
