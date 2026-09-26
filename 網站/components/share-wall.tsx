"use client";

import Link from "next/link";
import { useState } from "react";
import { CURRENT_USER, shareHasTag, type ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";

type Scope = { all: true } | { tag: string } | { author: string } | { none: true };

/** 首頁以炫收藏為主：排序在前，「只看在賣」是次要開關 */
export type WallFilter = "all" | "selling";
export type WallSort = "new" | "likes";

const SORTS: { key: WallSort; label: string }[] = [
  { key: "new", label: "最新" },
  { key: "likes", label: "最多讚" },
];

export const PAGE_SIZE = 24;

type WallQuery = { sort: WallSort; filter: WallFilter };

const wallHref = ({ sort, filter }: WallQuery, page: number) => {
  const q = new URLSearchParams();
  if (sort !== "new") q.set("sort", sort);
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

  const mine = state.myShares.filter((s) => {
    if ("all" in scope) return true;
    if ("tag" in scope) return shareHasTag(s, scope.tag);
    if ("author" in scope) return scope.author === CURRENT_USER;
    return false;
  });

  const list = [...mine, ...shares]
    .filter((s) => {
      if (filter === "all") return true;
      const st = saleOf(s).state;
      return st === "sale" || st === "offer";
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

  return (
    <div className="wall-wrap">
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
      {shown.length === 0 ? (
        (empty ?? null)
      ) : (
        <div className="wall">
          {shown.map((s) => (
            <ShareCard key={s.n} share={s} />
          ))}
        </div>
      )}
      {paged ? <Pager page={current} total={totalPages} query={{ sort, filter }} /> : null}
    </div>
  );
}
