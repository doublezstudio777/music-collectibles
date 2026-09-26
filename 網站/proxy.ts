import { NextResponse } from "next/server";
import { indexingAllowed } from "@/lib/server/guard";

/**
 * 全站回應加 X-Robots-Tag（不給搜尋引擎收錄，開關是 ALLOW_INDEXING）。
 * 頁面另外有 <meta name="robots" content="noindex">（layout.tsx）。robots.txt 不擋爬取，理由見 app/robots.txt/route.ts。
 */
export function proxy() {
  const res = NextResponse.next();
  if (!indexingAllowed()) res.headers.set("X-Robots-Tag", "noindex");
  return res;
}
