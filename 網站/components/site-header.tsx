"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Mail, Search } from "lucide-react";
import { userHref } from "@/lib/data";
import { clearFollows } from "@/lib/state";
import { logout, openPanel, useAccount } from "@/lib/account";

export function SiteHeader() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const acc = useAccount();
  const unread = acc.unread > 0;
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
              {acc.status === "loading" ? <span className="ava ava-wait" aria-hidden="true" /> : null}
              {acc.status === "anon" ? (
                <button type="button" className="nav-login" onClick={() => openPanel("login")}>
                  登入
                </button>
              ) : null}
              {acc.status === "user" && acc.me ? (
              <details className="me-menu" ref={menu}>
                <summary className="ava" aria-label="我的選單">
                  {Array.from(acc.me.name)[0] ?? "我"}
                </summary>
                <div className="menu-panel">
                  <p className="menu-now">{acc.me.name}</p>
                  <Link href={userHref(acc.me.handle)} onClick={close}>
                    我的頁
                  </Link>
                  <Link href="/me/likes" onClick={close}>
                    喜愛清單
                  </Link>
                  <Link href="/messages" onClick={close}>
                    私訊
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
