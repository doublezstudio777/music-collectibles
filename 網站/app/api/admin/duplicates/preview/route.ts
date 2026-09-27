import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { previewMerge } from "@/lib/server/duplicates";

/** 合併前看會搬動幾筆：{ keep, lose } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await previewMerge(b.keep, b.lose)));
}
