import { requireConsented } from "@/lib/server/terms";
import { json, readBody } from "@/lib/server/auth";
import { fillVersionField } from "@/lib/server/scores";
import { handle } from "@/lib/server/trade";

/** 補上版本的空白欄位（只能補空白的）：{ key: "{藝人}/{流水號}#{品項}-{版本}", field: year|region|label|packaging|contents|tracks|catalog|identifyBy, value } */
export async function POST(req: Request) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await fillVersionField(s.user, b.key, b.field, b.value)));
}
