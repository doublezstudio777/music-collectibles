"use client";

import Link from "next/link";
import { useState } from "react";
import { artistHref, CURRENT_USER, hotArtists, shareAboutArtist, shareHasTag, type ShareView } from "@/lib/data";
import { lockOfShare, useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";
import { FollowButton } from "@/components/follow-button";

type Scope =
  | { all: true }
  | { tag: string }
  | { author: string }
  | { none: true }
  /** 同系列（任何品項、版本） */
  | { series: string }
  /** 同品項，鍵＝itemKey：`{發行方}/{流水號}#{品項}` */
  | { item: string }
  /** 同品項但版本未定（沒選版本） */
  | { itemLoose: string }
  /** 同版本，鍵＝versionKey：`{發行方}/{流水號}#{品項}-{版本}` */
  | { version: string };

const shareItemKey = (s: Pick<ShareView, "link">) =>
  s.link?.seriesKey && s.link.itemId ? `${s.link.seriesKey}#${s.link.itemId}` : undefined;
const shareVersionKey = (s: Pick<ShareView, "link">) =>
  s.link?.seriesKey && s.link.itemId && s.link.versionId ? `${s.link.seriesKey}#${s.link.itemId}-${s.link.versionId}` : undefined;

/** 首頁以炫收藏為主：排序在前，「只看在賣」是次要開關 */
export type WallFilter = "all" | "selling";
export type WallSort = "following" | "new" | "likes";

const SORTS: { key: WallSort; label: string }[] = [
  { key: "following", label: "追蹤中" },
  { key: "new", label: "最新" },
  { key: "likes", label: "最多讚" },
];

export const PAGE_SIZE = 24;

type WallQuery = { sort: WallSort; filter: WallFilter };

const wallHref = ({ sort, filter }: WallQuery, page: number) => {
  const q = new URLSearchParams();
  if (sort !== "following") q.set("sort", sort);
  if (filter !== "all") q.set("state", filter);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/?${s}` : "/";
};

/** 頁碼：1 … 4 [5] 6 … 12，頁數少時全列 */
function pageList(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

function Pager({ page, total, query }: { page: number; total: number; query: WallQuery }) {
  if (total <= 1) return null;
  const prev =
    page > 1 ? (
      <Link className="pg pg-arrow" href={wallHref(query, page - 1)} aria-label="上一頁">
        ‹
      </Link>
    ) : (
      <span className="pg pg-arrow pg-off" aria-hidden="true">
        ‹
      </span>
    );
  const next =
    page < total ? (
      <Link className="pg pg-arrow" href={wallHref(query, page + 1)} aria-label="下一頁">
        ›
      </Link>
    ) : (
      <span className="pg pg-arrow pg-off" aria-hidden="true">
        ›
      </span>
    );
  return (
    <nav className="pager" aria-label="分頁">
      {prev}
      {pageList(page, total).map((p, i) =>
        p === "gap" ? (
          <span key={`g${i}`} className="pg pg-gap pg-full" aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={p}
            className="pg pg-full"
            href={wallHref(query, p)}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </Link>
        ),
      )}
      <span className="pg pg-mini num">
        {page} / {total}
      </span>
      {next}
    </nav>
  );
}

/** 還沒追蹤任何藝人：一排熱門藝人，直接點追蹤 */
function HotArtists() {
  return (
    <section className="hot" aria-labelledby="hot-title">
      <h2 id="hot-title" className="hot-title">
        熱門藝人
      </h2>
      <ul className="hot-list">
        {hotArtists().map(({ artist, count }) => (
          <li key={artist.slug} className="hot-item">
            <Link className="hot-name" href={artistHref(artist.slug)}>
              {artist.name}
            </Link>
            <span className="sub">{count} 則收藏</span>
            <FollowButton slug={artist.slug} name={artist.name} small />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 炫收藏牆。伺服器給的示範資料，再疊上本機自己發的（符合範圍的才疊） */
export function ShareWall({
  shares,
  scope = { none: true },
  sortable = false,
  paged = false,
  filter = "all",
  initialSort = "new",
  page = 1,
  limit,
  empty,
}: {
  shares: ShareView[];
  scope?: Scope;
  sortable?: boolean;
  /** 首頁：排序分頁籤＋只看在賣＋每頁 24 則 */
  paged?: boolean;
  filter?: WallFilter;
  initialSort?: WallSort;
  page?: number;
  limit?: number;
  empty?: React.ReactNode;
}) {
  const { state, liked, saleOf } = useAppState();
  const [localSort, setSort] = useState<WallSort>("new");
  const sort = paged ? initialSort : localSort;
  /** 追蹤中分頁：沒追蹤任何藝人時，上方熱門藝人、下方照最新排 */
  const followingTab = paged && sort === "following";
  const noFollows = followingTab && state.ready && state.follows.length === 0;

  const mine = state.myShares.filter((s) => {
    if ("all" in scope) return true;
    if ("tag" in scope) return shareHasTag(s, scope.tag);
    if ("author" in scope) return scope.author === CURRENT_USER;
    if ("series" in scope) return s.link?.seriesKey === scope.series;
    if ("item" in scope) return shareItemKey(s) === scope.item;
    if ("itemLoose" in scope) return !s.link?.versionId && shareItemKey(s) === scope.itemLoose;
    if ("version" in scope) return shareVersionKey(s) === scope.version;
    return false;
  });

  const list = [...mine, ...shares]
    .filter((s) => {
      if (!followingTab || noFollows) return true;
      return state.follows.some((slug) => shareAboutArtist(s, slug));
    })
    .filter((s) => {
      if (filter === "all") return true;
      const st = saleOf(s).state;
      return (st === "sale" || st === "offer") && !lockOfShare(state, s);
    })
    .sort((a, b) =>
      sort === "likes"
        ? b.likes + (liked(b.n) ? 1 : 0) - (a.likes + (liked(a.n) ? 1 : 0))
        : b.order - a.order,
    );
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const shown = paged
    ? list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
    : limit
      ? list.slice(0, limit)
      : list;

  /** 追蹤中要等 localStorage 讀進來才知道追了誰，之前不畫牆 */
  const waiting = followingTab && !state.ready;

  return (
    <div className="wall-wrap" data-tab={paged ? sort : undefined}>
      {paged || sortable ? (
        <div className="wall-bar">
          {paged ? (
            <>
              <nav className="filters" aria-label="排序">
                {SORTS.map((o) => (
                  <Link
                    key={o.key}
                    className="filter"
                    href={wallHref({ sort: o.key, filter }, 1)}
                    aria-current={o.key === sort ? "page" : undefined}
                  >
                    {o.label}
                  </Link>
                ))}
              </nav>
              <Link
                className="sell-toggle"
                href={wallHref({ sort, filter: filter === "all" ? "selling" : "all" }, 1)}
                data-on={filter === "selling"}
                aria-current={filter === "selling" ? "true" : undefined}
              >
                只看在賣
              </Link>
            </>
          ) : (
            <span />
          )}
          {sortable && !paged ? (
            <>
              <label className="sr-only" htmlFor="wall-sort">
                排序
              </label>
              <select
                id="wall-sort"
                className="select"
                value={sort}
                onChange={(e) => setSort(e.target.value as "new" | "likes")}
              >
                <option value="new">最新</option>
                <option value="likes">最多讚</option>
              </select>
            </>
          ) : null}
        </div>
      ) : null}
      {noFollows ? <HotArtists /> : null}
      {waiting ? null : shown.length === 0 ? (
        followingTab ? (
          <p className="empty">追蹤的藝人還沒有新的收藏</p>
        ) : (
          (empty ?? null)
        )
      ) : (
        <div className="wall">
          {shown.map((s) => (
            <ShareCard key={s.n} share={s} />
          ))}
        </div>
      )}
      {paged && !waiting ? <Pager page={current} total={totalPages} query={{ sort, filter }} /> : null}
    </div>
  );
}

/**
 * 系列頁「不確定版本」區塊：伺服器給的清單＋本機同品項沒選版本的炫收藏。
 * 兩邊都空才整塊不出現（本機那份要等 client 掛載才知道，所以這塊本身要是 client component）。
 */
export function ItemLooseWall({ itemScopeKey, shares }: { itemScopeKey: string; shares: ShareView[] }) {
  const { state } = useAppState();
  const hasMine = state.myShares.some((s) => !s.link?.versionId && shareItemKey(s) === itemScopeKey);
  if (shares.length === 0 && !hasMine) return null;
  return (
    <section className="ver-block">
      <h3 className="ver-title">不確定版本</h3>
      <ShareWall shares={shares} scope={{ itemLoose: itemScopeKey }} />
    </section>
  );
}
