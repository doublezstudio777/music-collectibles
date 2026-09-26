"use client";

import { toggleFollow, useAppState } from "@/lib/state";

/** 追蹤藝人：追蹤中是黑底白字 */
export function FollowButton({ slug, name, small = false }: { slug: string; name: string; small?: boolean }) {
  const { follows, ready } = useAppState();
  const on = follows(slug);
  return (
    <button
      type="button"
      className={`btn follow${on ? " is-on" : ""}${small ? " follow-sm" : ""}`}
      aria-pressed={ready ? on : undefined}
      aria-label={on ? `追蹤中：${name}` : `追蹤 ${name}`}
      onClick={() => toggleFollow(slug)}
    >
      {on ? "追蹤中" : "追蹤"}
    </button>
  );
}
