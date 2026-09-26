// 伺服器元件（頁面）拿目前登入者：讀請求的 cookie，跟 API 同一套 session。
// 頁面用它扣掉「自己那一下」的讚數與我有／想要人數，以及後台守門。

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

/** 頁面用：登入者＋內容目錄（讚數與我有／想要扣掉登入者自己那一下） */
export async function pageData() {
  const { getCatalog } = await import("@/lib/server/content");
  const viewer = await getViewer();
  return { viewer, c: await getCatalog(viewer?.id ?? null) };
}

/** 目前網站的來源（https://yinzang.dblzm.workers.dev），給 og:url、og:image 這類要絕對網址的地方 */
export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:5173";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
