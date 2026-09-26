"use client";

import { CURRENT_USER, type ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";

/** 個人頁「出售中」區塊：定價出售＋開放出價合併顯示；沒有出售中的收藏時整塊不出現 */
export function SaleWall({ shares, scopeAuthor }: { shares: ShareView[]; scopeAuthor: string }) {
  const { state, saleOf } = useAppState();
  const mine = scopeAuthor === CURRENT_USER ? state.myShares : [];
  const list = [...mine, ...shares]
    .filter((s) => {
      const st = saleOf(s).state;
      return st === "sale" || st === "offer";
    })
    .sort((a, b) => b.order - a.order);

  if (list.length === 0) return null;

  return (
    <section className="block">
      <h2 className="block-title">出售中</h2>
      <div className="wall">
        {list.map((s) => (
          <ShareCard key={s.n} share={s} />
        ))}
      </div>
    </section>
  );
}
