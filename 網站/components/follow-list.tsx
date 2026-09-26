"use client";

import Link from "next/link";
import { artistHref } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { FollowButton } from "@/components/follow-button";

type A = { slug: string; name: string; tagline: string };

/** 個人頁：追蹤的藝人（本人才看得到） */
export function FollowList({ artists }: { artists: A[] }) {
  const { state, ready } = useAppState();
  if (!ready) return null;
  const list = state.follows.map((slug) => artists.find((a) => a.slug === slug)).filter((a): a is A => a !== undefined);
  return (
    <section className="block" data-testid="follow-list">
      <h2 className="block-title">
        追蹤的藝人<span className="count">{list.length}</span>
      </h2>
      {list.length ? (
        <ul className="rows follow-rows">
          {list.map((a) => (
            <li key={a.slug} className="follow-row">
              <Link className="link row-main" href={artistHref(a.slug)}>
                {a.name}
              </Link>
              <span className="sub">{a.tagline}</span>
              <FollowButton slug={a.slug} name={a.name} small />
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">還沒追蹤藝人</p>
      )}
    </section>
  );
}
