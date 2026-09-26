import { fail, json } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { priceSummaries } from "@/lib/server/prices";

/** 某系列各版本的行情（App 用）：?series={slug}/{no}。不足 3 筆的版本不出現 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("series") ?? "";
  if (!/^[a-z0-9-]{1,60}\/\d{1,6}$/.test(key)) return fail(400, "BAD_REQUEST", "參數不對");
  const c = await getCatalog(null);
  if (!c.getSeriesByKey(key)) return fail(404, "NOT_FOUND", "找不到這個系列");
  const locked = new Set(c.shares.filter((s) => s.link?.series === key && c.toShareView(s).lock).map((s) => s.n));
  return json({ versions: Object.fromEntries(await priceSummaries(key, locked)) });
}
