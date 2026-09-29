/**
 * 暱稱旁的等級小標籤（「收藏家 Lv.3」／「館長」）。沒有值就不出現。
 * 點了連到新手指南的等級與稱號段（/guide#levels，2026-09-29）；所以不能放在別的連結裡面（連結不能巢狀）。
 * 用一般 <a> 整頁載入：站內換頁（Link）到 #levels 不會捲到錨點
 * card：收藏卡片用，窄卡片（手機兩欄）靠 CSS 藏起「 Lv.3」只留稱號，同一份 HTML 不分裝置
 */
export function LevelTag({ badge, card = false }: { badge?: string | null; card?: boolean }) {
  if (!badge) return null;
  const i = card ? badge.indexOf(" Lv.") : -1;
  return (
    <a href="/guide#levels" className={card ? "lv-tag lv-card" : "lv-tag"} data-testid="lv-tag" title="等級與稱號">
      {i > 0 ? (
        <>
          {badge.slice(0, i)}
          <span className="lv-num">{badge.slice(i)}</span>
        </>
      ) : (
        badge
      )}
    </a>
  );
}
