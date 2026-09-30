// 樂迷藏插圖（B 版正方形紙套，2026-09-30 用戶選定；前一版長方形紙套作廢）。內嵌 SVG：導覽列第一次畫面就有圖，不多一個請求。
// 圖形與 public/brand/logo-mark.svg 相同；viewBox 已置中成正方形（墨跡 204×128，上下左右留白相等），對齊文字時才量得準。
// 裝飾用：旁邊一定跟著「樂迷藏」字樣，所以 aria-hidden。規範見 DESIGN.md「Logo」。
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="9 -30 212 212" aria-hidden="true" focusable="false">
      <circle cx="158" cy="76" r="54" fill="#FF6A00" stroke="#111111" strokeWidth="8" />
      <circle cx="158" cy="76" r="8" fill="#FFFFFF" stroke="#111111" strokeWidth="5" />
      <rect x="16" y="16" width="120" height="120" fill="#FFFFFF" stroke="#111111" strokeWidth="8" />
      <rect x="36" y="36" width="44" height="44" fill="#FF6A00" />
      <path d="M36 112H116" fill="none" stroke="#111111" strokeWidth="8" />
    </svg>
  );
}
