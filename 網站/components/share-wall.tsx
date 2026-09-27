"use client";

import Link from "next/link";
import { useState } from "react";
import { artistHref, type ShareView } from "@/lib/data";
import { dismissArtist, useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";
import { FollowButton } from "@/components/follow-button";

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

export type HotArtist = { slug: string; name: string; count: number };

/** 熱門藝人顯示幾位（第 6 格是「看全部藝人」） */
const HOT_SHOWN = 5;

/**
 * 還沒追蹤任何藝人：一排熱門藝人。點名字進藝人頁；每位有「追蹤」「不感興趣」，
 * 按了不感興趣由下一位補上、之後不再推薦。最後一格連到藝人目錄。
 */
function HotArtists({ list }: { list: HotArtist[] }) {
  const { state } = useAppState();
  const shown = list.filter((a) => !state.dismissed.includes(a.slug)).slice(0, HOT_SHOWN);
  return (
    <section className="hot" aria-labelledby="hot-title">
      <h2 id="hot-title" className="hot-title">
        熱門藝人
      </h2>
      <ul className="hot-list">
        {shown.map((artist) => (
          <li key={artist.slug} className="hot-item" data-artist={artist.slug}>
            <Link className="hot-name" href={artistHref(artist.slug)}>
              {artist.name}
            </Link>
            <span className="sub">{artist.count} 則收藏</span>
            <span className="hot-acts">
              <FollowButton slug={artist.slug} name={artist.name} small />
              <button type="button" className="btn-text hot-dismiss" aria-label={`不感興趣：${artist.name}`} onClick={() => dismissArtist(artist.slug)}>
                不感興趣
              </button>
            </span>
          </li>
        ))}
        <li className="hot-item hot-all">
          <Link className="hot-name" href="/artists">
            看全部藝人
          </Link>
          <span className="sub">依類型與地區找</span>
        </li>
      </ul>
    </section>
  );
}

/** 炫收藏牆。資料都是伺服器從 D1 讀的；追蹤中、只看在賣、排序在這裡做 */
export function ShareWall({
  shares,
  hot = [],
  sortable = false,
  paged = false,
  filter = "all",
  initialSort = "new",
  page = 1,
  limit,
  empty,
}: {
  shares: ShareView[];
  /** 首頁：還沒追蹤藝人時上方那一排 */
  hot?: HotArtist[];
  sortable?: boolean;
  /** 首頁：排序分頁籤＋只看在賣＋每頁 24 則 */
  paged?: boolean;
  filter?: WallFilter;
  initialSort?: WallSort;
  page?: number;
  limit?: number;
  empty?: React.ReactNode;
}) {
  const { state, liked } = useAppState();
  const [localSort, setSort] = useState<WallSort>("new");
  const sort = paged ? initialSort : localSort;
  /** 追蹤中分頁：沒追蹤任何藝人時，上方熱門藝人、下方照最新排 */
  const followingTab = paged && sort === "following";
  const noFollows = followingTab && state.ready && state.follows.length === 0;

  const list = [...shares]
    .filter((s) => {
      if (!followingTab || noFollows) return true;
      return state.follows.some((slug) => s.aboutSlugs.includes(slug));
    })
    .filter((s) => {
      if (filter === "all") return true;
      const st = s.sale.state;
      return (st === "sale" || st === "offer") && !s.lock;
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

  /** 追蹤中要等 /api/me 讀進來才知道追了誰，之前不畫牆 */
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
      {noFollows ? <HotArtists list={hot} /> : null}
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

/** 系列頁「不確定版本」區塊：同品項沒選版本的炫收藏，沒有就整塊不出現 */
export function ItemLooseWall({ shares }: { shares: ShareView[] }) {
  if (shares.length === 0) return null;
  return (
    <section className="ver-block">
      <h3 className="ver-title">不確定版本</h3>
      <ShareWall shares={shares} />
    </section>
  );
}

/** 版本底下的炫收藏排序（2026-09-28）：預設精選 */
export type VersionSort = "featured" | "new" | "likes" | "selling";
const VERSION_SORTS: { key: VersionSort; label: string }[] = [
  { key: "featured", label: "精選" },
  { key: "new", label: "最新" },
  { key: "likes", label: "最多讚" },
  { key: "selling", label: "在賣的" },
];
/** 每個版本先顯示幾則 */
export const VERSION_SHOWN = 6;

/**
 * 精選＝「已確認版本且照片可當辨識參考」的排前面 → 讚數多的 → 新的。
 * 同一個版本區塊裡的收藏都掛在同一個版本，「已確認版本」看的是這個版本的資料狀態（confirmed）。
 */
export function sortVersionShares(list: ShareView[], sort: VersionSort, confirmed: boolean, likesOf: (s: ShareView) => number) {
  const byNew = (a: ShareView, b: ShareView) => b.order - a.order;
  const byLikes = (a: ShareView, b: ShareView) => likesOf(b) - likesOf(a) || byNew(a, b);
  const featured = (s: ShareView) => (confirmed && s.refPhoto ? 1 : 0);
  if (sort === "new") return [...list].sort(byNew);
  if (sort === "likes") return [...list].sort(byLikes);
  if (sort === "selling") return list.filter((s) => (s.sale.state === "sale" || s.sale.state === "offer") && !s.lock).sort(byNew);
  return [...list].sort((a, b) => featured(b) - featured(a) || byLikes(a, b));
}

/** 系列頁每個版本的炫收藏：排序分頁籤＋先顯示 6 則，其餘收進「看全部 N 則」 */
export function VersionWall({ shares, confirmed, id }: { shares: ShareView[]; confirmed: boolean; id: string }) {
  const { liked } = useAppState();
  const [sort, setSort] = useState<VersionSort>("featured");
  const [all, setAll] = useState(false);
  if (shares.length === 0) return <p className="empty">還沒有人炫過這個版本</p>;
  const list = sortVersionShares(shares, sort, confirmed, (s) => s.likes + (liked(s.n) ? 1 : 0));
  const shown = all ? list : list.slice(0, VERSION_SHOWN);
  return (
    <div className="wall-wrap" data-testid="version-wall" data-sort={sort}>
      <div className="wall-bar">
        <nav className="filters" aria-label="排序">
          {VERSION_SORTS.map((o) => (
            <button
              key={o.key}
              type="button"
              className="filter"
              aria-pressed={o.key === sort}
              aria-current={o.key === sort ? "true" : undefined}
              onClick={() => setSort(o.key)}
            >
              {o.label}
            </button>
          ))}
        </nav>
        <span />
      </div>
      {shown.length === 0 ? (
        <p className="empty">這個版本目前沒有人在賣</p>
      ) : (
        <div className="wall" id={`${id}-wall`}>
          {shown.map((s) => (
            <ShareCard key={s.n} share={s} />
          ))}
        </div>
      )}
      {!all && list.length > VERSION_SHOWN ? (
        <button type="button" className="btn btn-line more-all" aria-controls={`${id}-wall`} onClick={() => setAll(true)} data-testid="version-more">
          看全部 {list.length} 則
        </button>
      ) : null}
    </div>
  );
}
