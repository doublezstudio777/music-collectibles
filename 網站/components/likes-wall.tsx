"use client";

import type { ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { ShareCard } from "@/components/share-card";

export function LikesWall({ all }: { all: ShareView[] }) {
  const { state, ready } = useAppState();
  if (!ready) return null;
  const pool = [...state.myShares, ...all];
  const list = state.liked
    .slice()
    .reverse()
    .map((n) => pool.find((s) => s.n === n))
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
        <p className="empty">還沒有點過讚</p>
      )}
    </>
  );
}
