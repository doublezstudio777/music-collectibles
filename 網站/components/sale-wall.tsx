"use client";

import { CURRENT_USER, type ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";

/** 個人頁「出售中」分頁：定價出售＋開放出價，兩種狀態合併顯示 */
export function SaleWall({ shares, scopeAuthor }: { shares: ShareView[]; scopeAuthor: string }) {
  const { state, saleOf } = useAppState();
  const mine = scopeAuthor === CURRENT_USER ? state.myShares : [];
  const list = [...mine, ...shares]
    .filter((s) => {
      const st = saleOf(s).state;
      return st === "sale" || st === "offer";
    })
    .sort((a, b) => b.order - a.order);

  if (list.length === 0) return <p className="empty">目前沒有出售中的收藏</p>;

  return (
    <div className="wall">
      {list.map((s) => (
        <ShareCard key={s.n} share={s} />
      ))}
    </div>
  );
}
