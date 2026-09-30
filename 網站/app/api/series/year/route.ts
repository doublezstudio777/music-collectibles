import { requireConsented } from "@/lib/server/terms";
import { json, readBody } from "@/lib/server/auth";
import { fillSeriesYear } from "@/lib/server/scores";
import { handle } from "@/lib/server/trade";

/** 補上系列的發行年（只能補空白的）：{ key: "{藝人}/{流水號}", year: "2019" }。補別人新增的系列算「補上缺漏資料」 */
export async function POST(req: Request) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await fillSeriesYear(s.user, b.key, b.year)));
}
