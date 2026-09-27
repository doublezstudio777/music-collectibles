"use client";

import { useAccount } from "@/lib/account";

/** 只有登入者本人看自己的個人頁才顯示 */
export function SelfOnly({ handle, children }: { handle: string; children: React.ReactNode }) {
  const { me } = useAccount();
  return me?.handle === handle ? <>{children}</> : null;
}

export function useIsSelf(handle: string) {
  const { me, status } = useAccount();
  return { isSelf: me?.handle === handle, ready: status !== "loading" };
}

/** 不是本人才顯示（例：別人的大頭貼才有「檢舉大頭貼」）；登入狀態還沒讀到前不顯示 */
export function NotSelf({ handle, children }: { handle: string; children: React.ReactNode }) {
  const { me, status } = useAccount();
  return status === "loading" || me?.handle === handle ? null : <>{children}</>;
}
