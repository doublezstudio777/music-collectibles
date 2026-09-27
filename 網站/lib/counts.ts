"use client";

// 讚數、我有／想要人數的顯示（2026-09-28 CPU 修正起）。
//
// 伺服器給的是資料庫總數，包含登入者自己那一下：公開頁面不因人而異，整頁才能快取（worker.ts）。
// 前端記下「拿到這份總數時自己按了沒」，扣回去再疊上現在的狀態，按了馬上變。
// 帳號還在讀的時候直接顯示總數；換帳號（登入、登出）或伺服器給了新的總數就重記一次。

import { useState } from "react";
import { useAppState } from "@/lib/state";

type Snap = { total: number; who: string; mine: boolean };

export function useLiveCount(total: number, on: boolean): number {
  const { ready, me } = useAppState();
  const who = me?.id ?? "";
  const [snap, setSnap] = useState<Snap | null>(null);
  const stale = !snap || snap.total !== total || snap.who !== who;
  const cur = ready && stale ? { total, who, mine: on } : snap;
  if (ready && stale) setSnap(cur);
  if (!ready || !cur) return total;
  return total - (cur.mine ? 1 : 0) + (on ? 1 : 0);
}
