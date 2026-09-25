import Link from "next/link";
import { CURRENT_USER, userHref, type ShareView } from "@/lib/data";
import { LikeButton } from "@/components/like-button";
import { NextPhase } from "@/components/next-phase";
import { Photo, TagList } from "@/components/share-card";

export function ShareDetail({ share }: { share: ShareView }) {
  const mine = share.author.handle === CURRENT_USER;
  return (
    <div className="detail">
      <div className={share.image ? "detail-photo has-image" : "detail-photo"}>
        <Photo share={share} sizes="(max-width: 1000px) 100vw, 640px" />
      </div>
      <div className="detail-info">
        <h1 className="page-title">{share.what}</h1>
        <div className="detail-by">
          <Link className="who" href={userHref(share.author.handle)}>
            <span className="ava ava-sm" aria-hidden="true">
              {share.author.initials}
            </span>
            <span>{share.author.name}</span>
          </Link>
          <span className="when">{share.time}</span>
          <LikeButton n={share.n} base={share.likes} large />
        </div>
        {share.story ? <p className="prose">{share.story}</p> : null}
        <TagList about={share.about} tags={share.tags} />
        {share.link ? (
          <p className="detail-link">
            <Link className="link" href={share.link.href}>
              {share.link.label}
            </Link>
          </p>
        ) : mine ? (
          <p className="detail-link">
            <NextPhase label="補上作品或版本" className="btn btn-line" />
          </p>
        ) : null}
      </div>
    </div>
  );
}
