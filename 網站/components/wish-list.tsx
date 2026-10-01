"use client";

// 願望清單（/me/likes，2026-10-01 願望清單統一）：全站只有一個「願望清單」，一律用愛心。
// - 想要的專輯／版本：系列頁版本上的愛心「加入願望清單」（資料表照舊 holdings.kind = 'wanted'）
// - 喜歡的收藏：收藏卡片的愛心（likes）
// 兩個分頁，切換不換頁（網址 ?tab=shares 同步，直接開也到對的分頁）。
// 版本有人在賣（定價出售、開放出價，被鎖的不算）就標「有 N 件出售中」並連過去：一件連那則，多件連系列頁的版本段落。

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/link";
import type { HoldingView, ShareView } from "@/lib/data";
import { api, openPanel, useAccount } from "@/lib/account";
import { toggleHolding, useAppState } from "@/lib/state";
import { Heart } from "@/components/like-button";
import { ShareCard } from "@/components/share-card";

export type WishTab = "versions" | "shares";

function VersionRows({ keys }: { keys: string[] }) {
  const [views, setViews] = useState<Map<string, HoldingView | null>>(new Map());
  const missing = keys.filter((k) => !views.has(k));
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    let live = true;
    // 一次最多 300 個鍵（/api/holding-views 的上限），超過分批
    const parts: string[][] = [];
    const all = missingKey.split(",");
    for (let i = 0; i < all.length; i += 300) parts.push(all.slice(i, i + 300));
    void Promise.all(parts.map((p) => api<{ views: HoldingView[] }>(`/api/holding-views?keys=${encodeURIComponent(p.join(","))}`))).then((rs) => {
      if (!live) return;
      setViews((m) => {
        const next = new Map(m);
        for (const r of rs) if (r.ok) for (const v of r.data.views) next.set(v.key, v);
        // 找不到的鍵（版本被隱藏、刪除）記成空，不再重要
        for (const k of all) if (!next.has(k)) next.set(k, null);
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [missingKey]);

  // 最新加入的在前；有人在賣的排最前面（願望清單最有用的就是這個）
  const rows = useMemo(
    () =>
      keys
        .slice()
        .reverse()
        .map((k) => views.get(k))
        .filter((v): v is HoldingView => Boolean(v))
        .map((v, i) => ({ v, i }))
        .sort((a, b) => Number(Boolean(b.v.onSale)) - Number(Boolean(a.v.onSale)) || a.i - b.i)
        .map((x) => x.v),
    [keys, views],
  );
  // 還在跟伺服器要顯示資料（第一次開）就先不畫，免得閃一下「還沒有」
  if (missing.length && !rows.length) return null;
  const selling = rows.filter((r) => r.onSale).length;
  return (
    <>
      <p className="page-meta" data-testid="wish-meta">
        <span className="num">{rows.length}</span> 個
        {selling ? (
          <>
            {" · "}
            <span className="num">{selling}</span> 個有人在賣
          </>
        ) : null}
      </p>
      {rows.length ? (
        <ul className="wish-list" data-testid="wish-versions">
          {rows.map((r) => (
            <li key={r.key} className="wish-row" data-key={r.key}>
              <div className="wish-main">
                <Link className="wish-title link" href={r.href}>
                  {r.artists}《{r.title}》
                </Link>
                <span className="wish-sub">
                  {r.unsure ? <span className="sub-inline">{r.edition}</span> : r.edition}
                  {r.year && !r.edition.startsWith(r.year) ? <span className="num"> · {r.year}</span> : null}
                </span>
                {r.onSale && r.saleHref ? (
                  // 多件時連系列頁的錨點：站內 <Link> 換頁不會捲到錨點，用一般 <a>
                  <a className="wish-sale" href={r.saleHref} data-testid="wish-sale">
                    有 <span className="num">{r.onSale}</span> 件出售中
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                className="like is-on wish-remove"
                aria-pressed="true"
                aria-label={`從願望清單移除 ${r.artists}《${r.title}》${r.edition}`}
                onClick={() => toggleHolding("wanted", r.key)}
              >
                <Heart />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">還沒有想要的專輯或版本</p>
      )}
    </>
  );
}

function ShareRows({ all, liked }: { all: ShareView[]; liked: number[] }) {
  const list = liked
    .slice()
    .reverse()
    .map((n) => all.find((s) => s.n === n))
    .filter((s): s is ShareView => Boolean(s));
  return (
    <>
      <p className="page-meta">
        <span className="num">{list.length}</span> 則
      </p>
      {list.length ? (
        <div className="wall">
          {list.map((s) => (
            <ShareCard key={s.n} share={s} />
          ))}
        </div>
      ) : (
        <p className="empty">還沒有喜歡的收藏</p>
      )}
    </>
  );
}

export function WishList({ all, initialTab }: { all: ShareView[]; initialTab: WishTab }) {
  const { state, ready } = useAppState();
  const { status } = useAccount();
  const [tab, setTab] = useState<WishTab>(initialTab);
  if (!ready) return null;
  if (status === "anon") {
    return (
      <p className="empty">
        登入後才看得到自己的願望清單
        <button type="button" className="btn btn-p empty-btn" onClick={() => openPanel("login")}>
          登入
        </button>
      </p>
    );
  }
  const go = (t: WishTab) => {
    setTab(t);
    window.history.replaceState(window.history.state, "", t === "shares" ? "/me/likes?tab=shares" : "/me/likes");
  };
  const likedCount = state.liked.filter((n) => all.some((s) => s.n === n)).length;
  return (
    <>
      <nav className="filters wish-tabs" aria-label="願望清單分類">
        <button type="button" className="filter" aria-pressed={tab === "versions"} onClick={() => go("versions")} data-testid="wish-tab-versions">
          想要的專輯／版本 <span className="num">{state.wanted.length}</span>
        </button>
        <button type="button" className="filter" aria-pressed={tab === "shares"} onClick={() => go("shares")} data-testid="wish-tab-shares">
          喜歡的收藏 <span className="num">{likedCount}</span>
        </button>
      </nav>
      {tab === "versions" ? <VersionRows keys={state.wanted} /> : <ShareRows all={all} liked={state.liked} />}
    </>
  );
}
