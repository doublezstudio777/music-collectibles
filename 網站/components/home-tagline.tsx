"use client";

// 首頁標語（2026-09-30 使用者定稿）：訪客與登入會員一律顯示，不看登入狀態。
// 收合時第一句＋「看更多」，按了在原地展開全文（不跳頁），「來信告訴我們」連到 /feedback。
// 伺服器與瀏覽器第一次畫的都是收合狀態，整頁快取給誰都同一份，第一個畫面不會閃也不會跳。
// 之前「登入者收起」的做法（opacity 切換、<html data-auth>、localStorage lmb_auth）已撤掉。
import Link from "next/link";
import { useState } from "react";
import { TAGLINE_END, TAGLINE_FIRST, TAGLINE_LINK_HREF, TAGLINE_LINK_TEXT, TAGLINE_REST_BEFORE_LINK } from "@/lib/tagline";

export function HomeTagline() {
  const [open, setOpen] = useState(false);
  return (
    <p className="home-tagline" data-testid="home-tagline" data-open={open ? "1" : "0"}>
      <span>{TAGLINE_FIRST}</span>
      {open ? (
        <span id="home-tagline-rest" data-testid="home-tagline-rest">
          {TAGLINE_REST_BEFORE_LINK}
          <Link href={TAGLINE_LINK_HREF} className="home-tagline-link">
            {TAGLINE_LINK_TEXT}
          </Link>
          {TAGLINE_END}
        </span>
      ) : (
        <button type="button" className="home-tagline-more" aria-expanded="false" aria-controls="home-tagline-rest" onClick={() => setOpen(true)} data-testid="home-tagline-more">
          看更多
        </button>
      )}
    </p>
  );
}
