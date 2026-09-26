"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Mail, Search } from "lucide-react";
import { CURRENT_USER, getUser, userHref } from "@/lib/data";
import { NextPhase } from "@/components/next-phase";
import { useAppState } from "@/lib/state";

export function SiteHeader() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const me = getUser(CURRENT_USER);
  const { state } = useAppState();
  const unread = state.unread.length > 0;
  const isForm = pathname === "/share/new";
  const close = () => {
    if (menu.current) menu.current.open = false;
  };

  return (
    <header className="nav">
      <div className="wrap nav-row">
        <Link className="logo" href="/">
          音藏
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
              <Link className="nav-msg" href="/messages" aria-label={unread ? "私訊，有未讀" : "私訊"}>
                <Mail aria-hidden="true" />
                {unread ? <span className="unread-dot" aria-hidden="true" /> : null}
              </Link>
              <Link className="btn btn-p" href="/share/new">
                炫收藏
              </Link>
              <details className="me-menu" ref={menu}>
                <summary className="ava" aria-label="我的選單">
                  {me?.initials}
                </summary>
                <div className="menu-panel">
                  <Link href={userHref(CURRENT_USER)} onClick={close}>
                    我的頁
                  </Link>
                  <Link href="/me/likes" onClick={close}>
                    喜愛清單
                  </Link>
                  <Link href="/messages" onClick={close}>
                    私訊
                  </Link>
                  <NextPhase label="設定" className="menu-item" />
                  <NextPhase label="登出" className="menu-item" />
                </div>
              </details>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
