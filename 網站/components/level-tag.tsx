/** 暱稱旁的等級小標籤（「收藏家 Lv.3」／「館長」）。沒有值就不出現 */
export function LevelTag({ badge }: { badge?: string | null }) {
  if (!badge) return null;
  return (
    <span className="lv-tag" data-testid="lv-tag">
      {badge}
    </span>
  );
}
