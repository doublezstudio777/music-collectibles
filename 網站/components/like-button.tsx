"use client";

import { useShownCount } from "@/lib/counts";
import { toggleLike, useAppState } from "@/lib/state";

export function Heart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="heart">
      <path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z" />
    </svg>
  );
}

/** 讚數公開；誰點的不公開。base 是頁面 HTML 裡的總讚數（可能較舊），顯示以 /api/counts 的新數字為準（lib/counts.ts） */
export function LikeButton({ n, base, large = false }: { n: number; base: number; large?: boolean }) {
  const { liked, ready } = useAppState();
  const on = liked(n);
  const count = useShownCount("likes", n, base, on);
  return (
    <button
      type="button"
      className={`like${on ? " is-on" : ""}${large ? " like-lg" : ""}`}
      aria-pressed={ready ? on : undefined}
      aria-label={on ? "取消讚" : "點讚"}
      onClick={() => toggleLike(n)}
    >
      <Heart />
      <span className="num">{count}</span>
    </button>
  );
}
