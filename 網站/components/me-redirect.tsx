"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAccount } from "@/lib/account";

/** /me：登入了就到自己的個人頁，沒登入到登入頁 */
export function MeRedirect() {
  const { status, me } = useAccount();
  const router = useRouter();
  useEffect(() => {
    if (status === "user" && me) router.replace(`/u/${me.handle}`);
    if (status === "anon") router.replace("/login?next=/me");
  }, [status, me, router]);
  return null;
}
