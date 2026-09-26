"use client";

import Link from "next/link";
import { useState } from "react";
import { CURRENT_USER, shareHasTag, type ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";

type Scope = { all: true } | { tag: string } | { author: string } | { none: true };

export type WallFilter = "all" | "sale" | "offer";

const FILTERS: { key: WallFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "sale", label: "定價出售" },
  { key: "offer", label: "開放出價" },
];

export const PAGE_SIZE = 24;

const wallHref = (filter: WallFilter, page: number) => {
  const q = new URLSearchParams();
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

function Pager({ page, total, filter }: { page: number; total: number; filter: WallFilter }) {
  if (total <= 1) return null;
  const prev =
    page > 1 ? (
      <Link className="pg pg-arrow" href={wallHref(filter, page - 1)} aria-label="上一頁">
        ‹
      </Link>
    ) : (
      <span className="pg pg-arrow pg-off" aria-hidden="true">
        ‹
      </span>
    );
  const next =
    page < total ? (
      <Link className="pg pg-arrow" href={wallHref(filter, page + 1)} aria-label="下一頁">
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
            href={wallHref(filter, p)}
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
  page = 1,
  limit,
  empty,
}: {
  shares: ShareView[];
  scope?: Scope;
  sortable?: boolean;
  /** 首頁：篩選列＋每頁 24 則 */
  paged?: boolean;
  filter?: WallFilter;
  page?: number;
  limit?: number;
  empty?: React.ReactNode;
}) {
  const { state, liked, saleOf } = useAppState();
  const [sort, setSort] = useState<"new" | "likes">("new");

  const mine = state.myShares.filter((s) => {
    if ("all" in scope) return true;
    if ("tag" in scope) return shareHasTag(s, scope.tag);
    if ("author" in scope) return scope.author === CURRENT_USER;
    return false;
  });

  const list = [...mine, ...shares]
    .filter((s) => filter === "all" || saleOf(s).state === filter)
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
            <nav className="filters" aria-label="篩選">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  className="filter"
                  href={wallHref(f.key, 1)}
                  aria-current={f.key === filter ? "page" : undefined}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
          ) : (
            <span />
          )}
          {sortable ? (
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
      {paged ? <Pager page={current} total={totalPages} filter={filter} /> : null}
    </div>
  );
}
