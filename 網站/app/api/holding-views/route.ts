import { fail, json } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { validHoldingKey } from "@/lib/server/me";

/**
 * 我有／想要清單的顯示資料（2026-10-01）：?keys=鍵,鍵 → { views: HoldingView[] }，找不到的略過。
 * 個人頁本人剛勾的版本（伺服器清單裡還沒有）用；內容公開，跟系列頁看得到的一樣
 */
export async function GET(req: Request) {
  const keys = (new URL(req.url).searchParams.get("keys") ?? "").split(",").filter(Boolean);
  if (!keys.length || keys.length > 300 || !keys.every(validHoldingKey)) return fail(400, "BAD_REQUEST", "參數不對");
  const c = await getCatalog();
  return json({ views: c.holdingViews(Array.from(new Set(keys))) });
}
