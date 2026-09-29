"use client";

import { useRouter } from "next/navigation";
import { whenLoggedIn } from "@/lib/account";

/**
 * 資料空白處的「補上」（2026-09-29）：點了直接進那一欄的編輯。
 * 沒登入先開登入面板（面板在原頁上，登入完接著進編輯，不會離開原頁）
 */
export function FillLink({ href, testid }: { href: string; testid?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-line fill-btn"
      onClick={() => whenLoggedIn("登入後才能補資料", () => router.push(href))}
      data-testid={testid ?? "fill-link"}
      data-href={href}
    >
      補上
    </button>
  );
}
