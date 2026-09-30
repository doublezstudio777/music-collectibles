// 首頁標語＋「關於我們」（2026-09-30 使用者定案：訪客與登入會員一律顯示）。
// 伺服器直接畫、不看登入狀態：首頁整頁快取給誰都同一份 HTML，第一個畫面就在，不會閃也不會跳。
// 之前「登入者收起」的做法（opacity 切換、<html data-auth>、localStorage lmb_auth）已撤掉。
import Link from "next/link";

export function HomeTagline() {
  return (
    <p className="home-tagline" data-testid="home-tagline">
      <span>別讓一張專輯的來歷，只有少數人知道。</span>
      <Link href="/about" className="home-tagline-link">
        關於我們
      </Link>
    </p>
  );
}
