// 伺服器元件（頁面）拿目前登入者：讀請求的 cookie，跟 API 同一套 session。
// 後台與私人頁面守門用；公開頁面不讀（見 pageData）。

import { cache } from "react";
import { headers } from "next/headers";
import { userByToken, SESSION_COOKIE, type User } from "@/lib/server/auth";

export const getViewer = cache(async (): Promise<User | null> => {
  const h = await headers();
  const cookie = h.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  const s = await userByToken(m[1]);
  return s?.user ?? null;
});

export { isAdmin } from "@/lib/server/auth";

/**
 * 頁面用：內容目錄。不讀登入者：公開頁面不因人而異，整頁才能快取（worker.ts）。
 * 登入者自己的讚、我有、想要由前端從 /api/me 取得再疊上去（lib/counts.ts）。
 */
export async function pageData() {
  const { getCatalog } = await import("@/lib/server/content");
  return { c: await getCatalog() };
}

/**
 * 目前網站的來源，給 og:url、og:image 這類要絕對網址的地方。
 * 照請求的 host 算（正式網域 https://lemibox.com、舊網址 https://yinzang.dblzm.workers.dev 各回各的），不寫死：
 * 舊網址還沒轉址前兩邊都要能用。開放收錄前要改成固定回正式網域（canonical），避免兩個 host 同時被收錄
 */
export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:5173";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
