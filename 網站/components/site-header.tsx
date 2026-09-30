"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Plus, Search } from "lucide-react";
import { userHref } from "@/lib/data";
import { clearFollows } from "@/lib/state";
import { logout, openPanel, refreshAccount, useAccount } from "@/lib/account";
import { avatarLabel } from "@/lib/avatar-label";
import { SITE_NAME } from "@/lib/data";
import { LogoMark } from "@/components/logo-mark";

/** 私訊：直角對話框，線條跟其他圖示同粗細 */
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-svg">
      <path d="M3.5 4.5h17v12h-10l-4.5 3.5v-3.5h-2.5z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

/** 願望清單：跟點讚同一顆愛心 */
function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-svg">
      <path d="M12 20.5s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 5.5a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z" />
    </svg>
  );
}

/** 未讀：橘色小方塊＋數字（對話數），超過 99 顯示 99+ */
export function UnreadBadge({ n, className = "" }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={`unread-badge ${className}`} aria-hidden="true" data-testid="unread-badge">
      {n > 99 ? "99+" : n}
    </span>
  );
}

// 換頁或切回分頁時重讀未讀數，最多 15 秒一次（/api/me 不便宜，不做輪詢）
let lastRefresh = 0;
const refreshSoon = () => {
  if (Date.now() - lastRefresh < 15_000) return;
  lastRefresh = Date.now();
  void refreshAccount();
};

export function SiteHeader() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const acc = useAccount();
  const unread = acc.status === "user" ? acc.unread : 0;
  useEffect(() => {
    if (!lastRefresh) {
      lastRefresh = Date.now();
      return;
    }
    refreshSoon();
  }, [pathname]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refreshSoon();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const isForm = pathname === "/share/new";
  const label = acc.me ? avatarLabel(acc.me.name) : null;
  const close = () => {
    if (menu.current) menu.current.open = false;
  };

  return (
    <header className="nav">
      <div className="wrap nav-row">
        <Link className="logo" href="/">
          <LogoMark className="logo-mark" />
          <span className="logo-text">{SITE_NAME}</span>
        </Link>
        {isForm ? (
          <Link className="nav-cancel" href="/">
            取消
          </Link>
        ) : (
          <>
            <form className="nav-search" action="/search" role="search">
              <input name="q" className="input" placeholder="搜尋藝人、系列、收藏" aria-label="搜尋藝人、系列、收藏" />
            </form>
            <div className="nav-right">
              <Link className="nav-icon" href="/search" aria-label="搜尋">
                <Search aria-hidden="true" />
              </Link>
              <Link
                className="nav-link"
                href="/messages"
                aria-label={unread ? `私訊，${unread} 個對話未讀` : "私訊"}
                aria-current={pathname.startsWith("/messages") ? "page" : undefined}
                data-testid="nav-dm"
              >
                <span className="nav-ico">
                  <ChatIcon />
                  <UnreadBadge n={unread} />
                </span>
                <span className="nav-link-text">私訊</span>
              </Link>
              <Link
                className="nav-link"
                href="/me/likes"
                aria-label="願望清單"
                aria-current={pathname === "/me/likes" ? "page" : undefined}
                data-testid="nav-wish"
              >
                <span className="nav-ico">
                  <HeartIcon />
                </span>
                <span className="nav-link-text">願望清單</span>
              </Link>
              <Link className="btn btn-p nav-share" href="/share/new" aria-label="炫收藏">
                <span className="nav-share-text">炫收藏</span>
                <Plus className="nav-share-ico" aria-hidden="true" />
              </Link>
              {acc.status === "loading" ? <span className="ava ava-wait" aria-hidden="true" /> : null}
              {acc.status === "anon" ? (
                <button type="button" className="nav-login" onClick={() => openPanel("login")}>
                  登入
                </button>
              ) : null}
              {acc.status === "user" && acc.me ? (
              <details className="me-menu" ref={menu}>
                <summary
                  className={acc.me.avatar ? "ava ava-photo" : `ava ava-name${label?.size === "small" ? " ava-name-sm" : ""}`}
                  title={acc.me.name}
                  aria-label={`${acc.me.name}，我的選單`}
                  data-testid="me-avatar"
                >
                  {acc.me.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={acc.me.avatar} alt="" width={40} height={40} />
                  ) : (
                    label?.lines.map((line, i) => (
                      <span key={i} aria-hidden="true">
                        {line}
                      </span>
                    ))
                  )}
                </summary>
                <div className="menu-panel">
                  <p className="menu-now">{acc.me.name}</p>
                  <Link href={userHref(acc.me.handle)} onClick={close}>
                    我的頁面
                  </Link>
                  <Link href="/me/likes" onClick={close}>
                    願望清單
                  </Link>
                  <Link href="/messages" onClick={close}>
                    私訊
                  </Link>
                  <Link href="/ranking" onClick={close} data-testid="menu-ranking">
                    收藏榮譽榜
                  </Link>
                  {acc.me.admin ? (
                    <Link href="/admin" onClick={close}>
                      管理後台
                    </Link>
                  ) : null}
                  <Link href="/settings" onClick={close}>
                    設定
                  </Link>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      void clearFollows();
                      close();
                    }}
                  >
                    清掉追蹤
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      close();
                      void logout();
                    }}
                  >
                    登出
                  </button>
                </div>
              </details>
              ) : null}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
