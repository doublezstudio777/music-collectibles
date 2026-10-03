"use client";

// 管理後台左側選單（2026-10-03，WordPress 式）。選單內容只在 lib/admin-nav.ts 改。
// - 桌機（≥1024）：左側固定 232px，黏在頁首下方、自己捲動
// - 平板與手機：內容區左上「選單」鈕，從左側滑出抽屜＋遮罩；點遮罩、按 Esc、點選項都會關；開著時 Tab 不出抽屜
// - 分組可收合，收合狀態存這台瀏覽器（localStorage，讀寫失敗就當全部展開）；目前所在頁的分組進來時一律展開
// - 待處理數字：/api/admin/nav-counts 一次拿全部；換頁、切回分頁時重讀（最多 15 秒一次）
import Link from "@/components/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/account";
import { ADMIN_NAV, type AdminCounts, type AdminHref } from "@/lib/admin-nav";

const STORE = "lmb_admin_nav_closed";
const WIDE = "(min-width: 1024px)";

// 換頁時元件會重掛，數字先沿用上一頁拿到的，不閃
let lastCounts: AdminCounts | null = null;
let lastAt = 0;

function readClosed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveClosed(ids: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(ids));
  } catch {
    /* 無痕模式存不了：只在這一頁有效 */
  }
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <>
      <span className="unread-badge unread-inline admin-badge" aria-hidden="true" data-testid="admin-nav-badge">
        {n > 99 ? "99+" : n}
      </span>
      <span className="sr-only">，{n} 筆待處理</span>
    </>
  );
}

export function AdminNav({ current }: { current: AdminHref }) {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  const [counts, setCounts] = useState<AdminCounts | null>(lastCounts);
  const side = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const currentGroup = ADMIN_NAV.find((g) => g.items.some((i) => i.href === current))?.id;

  // 收合狀態：掛載後才讀（伺服器輸出一律全部展開）；目前所在頁的分組這次先展開，不寫回
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClosed(readClosed().filter((id) => id !== currentGroup));
  }, [currentGroup]);

  const toggle = (id: string) => {
    setClosed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // 存的是「使用者想收起來的」：目前所在頁的分組也照按的結果存
      const stored = readClosed().filter((x) => x !== id && !next.includes(x));
      saveClosed([...stored, ...next]);
      return next;
    });
  };

  const load = useCallback(async (force: boolean) => {
    if (!force && Date.now() - lastAt < 15_000) return;
    lastAt = Date.now();
    const r = await api<{ counts: AdminCounts }>("/api/admin/nav-counts");
    if (r.ok) {
      lastCounts = r.data.counts;
      setCounts(r.data.counts);
    }
  }, []);

  useEffect(() => {
    // 外部資料：/api/admin/nav-counts 回來才 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
    const onVis = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [load, current]);

  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus();
  }, []);

  // 抽屜開著：Esc 關、Tab 不出抽屜、背景不捲動；視窗拉寬到桌機就收起來
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia(WIDE);
    const onWide = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onWide);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    side.current?.querySelector<HTMLElement>(".admin-side-close")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab" && side.current) {
        const els = [...side.current.querySelectorAll<HTMLElement>("a[href], button")].filter((x) => !x.hasAttribute("disabled") && x.offsetParent !== null);
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (!side.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
    };
  }, [open, close]);

  const n = (k?: keyof AdminCounts) => (k && counts ? counts[k] : 0);

  return (
    <>
      <div className="admin-bar">
        <button
          type="button"
          className="admin-menu-btn"
          ref={opener}
          aria-expanded={open}
          aria-controls="admin-side"
          onClick={() => setOpen(true)}
          data-testid="admin-menu-btn"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-svg">
            <path d="M4 6.5h16M4 12h16M4 17.5h16" />
          </svg>
          <span>選單</span>
          {counts ? <Badge n={Object.values(counts).reduce((a, b) => a + b, 0)} /> : null}
        </button>
      </div>
      <div className="admin-scrim" data-open={open} onClick={close} aria-hidden="true" data-testid="admin-scrim" />
      <aside
        id="admin-side"
        className="admin-side"
        data-open={open}
        ref={side}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "管理後台選單" : undefined}
        data-testid="admin-side"
      >
        <div className="admin-side-head">
          <span>管理後台</span>
          <button type="button" className="admin-side-close" aria-label="關閉選單" onClick={close} data-testid="admin-side-close">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-svg">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav className="admin-nav" aria-label="管理後台">
          {ADMIN_NAV.map((g) => {
            const isClosed = g.title !== "" && closed.includes(g.id);
            const items = (
              <ul className="admin-nav-list" id={`admin-g-${g.id}`} hidden={isClosed}>
                {g.items.map((it) => {
                  const cnt = "count" in it ? n(it.count) : 0;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        className="admin-nav-link"
                        aria-current={it.href === current ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        data-testid={`admin-nav-${it.href.split("/")[2] ?? "dashboard"}`}
                      >
                        <span className="admin-nav-label">{it.label}</span>
                        <Badge n={cnt} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            );
            if (g.title === "") return <div key={g.id} className="admin-nav-group">{items}</div>;
            const sum = g.items.reduce((a, it) => a + ("count" in it ? n(it.count) : 0), 0);
            return (
              <div key={g.id} className="admin-nav-group">
                <button
                  type="button"
                  className="admin-group-btn"
                  aria-expanded={!isClosed}
                  aria-controls={`admin-g-${g.id}`}
                  onClick={() => toggle(g.id)}
                  data-testid={`admin-group-${g.id}`}
                >
                  <span className="admin-group-title">{g.title}</span>
                  {isClosed ? <Badge n={sum} /> : null}
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="admin-chev">
                    <path d="M6 9.5l6 6 6-6" />
                  </svg>
                </button>
                {items}
              </div>
            );
          })}
        </nav>
        <Link href="/" className="admin-back" data-testid="admin-back">
          ← 回到前台
        </Link>
      </aside>
    </>
  );
}
