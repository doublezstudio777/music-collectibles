// 樂迷藏插圖（唱片紙套，2026-09-30 定案第 5 案）。內嵌 SVG：導覽列第一次畫面就有圖，不多一個請求。
// 圖形與 public/brand/logo-mark.svg 相同；viewBox 貼齊圖形墨跡置中（上下左右留白相等），對齊文字時才量得準。
// 裝飾用：旁邊一定跟著「樂迷藏」字樣，所以 aria-hidden。規範見 DESIGN.md「Logo」。
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="2.5 -6 176 176" aria-hidden="true" focusable="false">
      <circle cx="112" cy="77" r="54" fill="#FF6A00" stroke="#111111" strokeWidth="8" />
      <circle cx="112" cy="77" r="8" fill="#FFFFFF" stroke="#111111" strokeWidth="5" />
      <rect x="15" y="20" width="102" height="124" fill="#FFFFFF" stroke="#111111" strokeWidth="8" />
      <path d="M31 40H76M31 53H63M31 124H100" fill="none" stroke="#111111" strokeWidth="7" />
      <rect x="31" y="73" width="34" height="34" fill="#FF6A00" />
    </svg>
  );
}
