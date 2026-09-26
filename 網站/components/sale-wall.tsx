import type { ShareView } from "@/lib/data";
import { ShareCard } from "@/components/share-card";

/** 個人頁「出售中」區塊：定價出售＋開放出價合併顯示；沒有出售中的收藏時整塊不出現 */
export function SaleWall({ shares }: { shares: ShareView[] }) {
  const list = shares.filter((s) => s.sale.state === "sale" || s.sale.state === "offer").sort((a, b) => b.order - a.order);
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
