"use client";

import { useState } from "react";
import { CURRENT_USER, shareHasTag, type ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";

type Scope = { all: true } | { tag: string } | { author: string } | { none: true };

/** 炫收藏牆。伺服器給的示範資料，再疊上本機自己發的（符合範圍的才疊） */
export function ShareWall({
  shares,
  scope = { none: true },
  sortable = false,
  limit,
  empty,
}: {
  shares: ShareView[];
  scope?: Scope;
  sortable?: boolean;
  limit?: number;
  empty?: React.ReactNode;
}) {
  const { state, liked } = useAppState();
  const [sort, setSort] = useState<"new" | "likes">("new");

  const mine = state.myShares.filter((s) => {
    if ("all" in scope) return true;
    if ("tag" in scope) return shareHasTag(s, scope.tag);
    if ("author" in scope) return scope.author === CURRENT_USER;
    return false;
  });

  const list = [...mine, ...shares].sort((a, b) =>
    sort === "likes"
      ? b.likes + (liked(b.n) ? 1 : 0) - (a.likes + (liked(a.n) ? 1 : 0))
      : b.order - a.order,
  );
  const shown = limit ? list.slice(0, limit) : list;

  return (
    <div className="wall-wrap">
      {sortable ? (
        <div className="wall-bar">
          <label className="sr-only" htmlFor="wall-sort">
            排序
          </label>
          <select id="wall-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as "new" | "likes")}>
            <option value="new">最新</option>
            <option value="likes">最多讚</option>
          </select>
        </div>
      ) : null}
      {shown.length === 0 ? (
        empty ?? null
      ) : (
        <div className="wall">
          {shown.map((s) => (
            <ShareCard key={s.n} share={s} />
          ))}
        </div>
      )}
    </div>
  );
}
