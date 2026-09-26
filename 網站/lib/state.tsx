"use client";

// 目前使用者的狀態（第 2b 階段起全部在 D1，經 /api/...；localStorage 不再使用）。
//
// 點讚、我有、想要、追蹤、自己檢舉過的、申訴、未讀數由 lib/account.tsx 從 /api/me 讀；
// 出售狀態、出價、鎖定是伺服器算好放進頁面（ShareView.sale／lock），寫入走 API 後 router.refresh()。
//
// 點讚與我有／想要分開存：點讚是「留著以後看」，不代表持有。

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api, useAccount, type ApiResult } from "@/lib/account";

export type Bucket = "owned" | "wanted";

export { clearFollows, dismissArtist, toggleFollow, toggleHolding, toggleLike } from "@/lib/account";

export function useAppState() {
  const acc = useAccount();
  const ready = acc.status !== "loading";
  const liked = useCallback((n: number) => acc.liked.includes(n), [acc.liked]);
  const holds = useCallback((b: Bucket, key: string) => acc[b].includes(key), [acc]);
  const follows = useCallback((slug: string) => acc.follows.includes(slug), [acc.follows]);
  const reported = useCallback((t: string) => acc.reported.includes(t), [acc.reported]);
  const state = useMemo(
    () => ({ follows: acc.follows, liked: acc.liked, owned: acc.owned, wanted: acc.wanted, dismissed: acc.dismissed, ready }),
    [acc, ready],
  );
  return {
    state,
    me: acc.me,
    liked,
    holds,
    follows,
    reported,
    verified: Boolean(acc.me?.verified),
    ready,
  };
}

/** 寫入 API 後重新讀伺服器資料（頁面上的出售狀態、出價、鎖定都是伺服器算的） */
export function useAction() {
  const router = useRouter();
  return useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> => {
      const r = await api<T>(path, init);
      if (r.ok) router.refresh();
      return r;
    },
    [router],
  );
}
