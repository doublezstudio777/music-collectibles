import { json, requireAdmin } from "@/lib/server/auth";
import { detectDuplicatePairs } from "@/lib/server/duplicates";

/** 疑似重複藝人清單（偵測規則見 lib/server/duplicates.ts） */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ pairs: await detectDuplicatePairs() }, 200, { "Cache-Control": "no-store" });
}
