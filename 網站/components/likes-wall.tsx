"use client";

import type { ShareView } from "@/lib/data";
import { useAppState } from "@/lib/state";
import { openPanel, useAccount } from "@/lib/account";
import { ShareCard } from "@/components/share-card";

export function LikesWall({ all }: { all: ShareView[] }) {
  const { state, ready } = useAppState();
  const { status } = useAccount();
  if (!ready) return null;
  if (status === "anon") {
    return (
      <p className="empty">
        登入後才看得到自己的喜愛清單
        <button type="button" className="btn btn-p empty-btn" onClick={() => openPanel("login")}>
          登入
        </button>
      </p>
    );
  }
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
