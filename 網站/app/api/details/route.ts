import { fail, json, requireUser } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { QUOTA_MESSAGE, quotaLimit, takeQuota } from "@/lib/server/quota";
import { versionKey } from "@/lib/data";

/**
 * 正版辨識細節（2026-09-28 防盜版批次）：辨識特徵、目錄號、條碼、逐項特徵（側標、印刷特寫…）、已知仿冒對照。
 * 登入會員才看得到，伺服器端檢查；公開頁面（整頁快取）不含這些內容。
 * GET /api/details?series={藝人}/{系列號} → 這個系列所有版本的細節，一次算一次瀏覽（每帳號每日上限，見 lib/server/quota.ts）。
 * 沒登入 401、到上限 429，錯誤訊息直接顯示。
 */
export async function GET(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return fail(401, "UNAUTHENTICATED", "登入後查看辨識細節");
  const key = new URL(req.url).searchParams.get("series") ?? "";
  const m = key.match(/^([^/]+)\/(\d+)$/);
  const c = await getCatalog();
  const series = m ? c.getSeries(m[1], Number(m[2])) : undefined;
  if (!series) return fail(404, "NOT_FOUND", "找不到這個系列");
  if (!(await takeQuota("detail", s.user.id, await quotaLimit("detail")))) {
    return fail(429, "DAILY_LIMIT", QUOTA_MESSAGE.detail);
  }
  const versions: Record<string, unknown> = {};
  for (const it of series.items) {
    for (const v of it.versions) {
      versions[versionKey(series, it, v)] = {
        identifyBy: v.identifyBy,
        catalog: v.catalog,
        barcode: v.barcode,
        marks: v.marks ?? [],
        fakes: v.fakes ?? [],
      };
    }
  }
  return json({ versions }, 200, { "Cache-Control": "private, no-store" });
}
