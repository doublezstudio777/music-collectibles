"use client";

// 首頁標語，只給訪客看（首頁整頁快取，登入者與訪客拿到同一份 HTML，顯示與否交給瀏覽器端判斷）。
// 節點一律渲染、佔位不變，只切換 opacity：避免登入狀態讀出來的那一刻畫面跳動，
// 也避免登入者看到訪客標語閃一下（未讀出登入狀態前預設隱藏）。
// 確定是登入者就整條收起（data-state="user"，見 globals.css），不留空白；上次是登入的人由 <html data-auth> 第一個畫面就收起。
import Link from "next/link";
import { useAccount } from "@/lib/account";

export function HomeTagline() {
  const acc = useAccount();
  const visible = acc.status === "anon";
  return (
    <p className="home-tagline" data-visible={visible} data-state={acc.status}>
      <span>別讓一張專輯的來歷，只有少數人知道。</span>
      <Link href="/about" className="home-tagline-link" tabIndex={visible ? 0 : -1} aria-hidden={!visible}>
        關於我們
      </Link>
    </p>
  );
}
