"use client";

import { useAppState } from "@/lib/state";
import { ShareDetail } from "@/components/share-detail";

/** 本機剛發的炫收藏只存在這台瀏覽器，伺服器找不到，改在瀏覽器端讀 */
export function LocalShare({ n }: { n: number }) {
  const { state, ready } = useAppState();
  if (!ready) return null;
  const share = state.myShares.find((s) => s.n === n);
  if (!share) return <p className="empty">找不到這則炫收藏</p>;
  return <ShareDetail share={share} />;
}
