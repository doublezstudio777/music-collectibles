import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { confirmAddition, listAdditions, mergeAddition, renameAddition } from "@/lib/server/additions";
import { handle } from "@/lib/server/trade";

/** 後台「待確認的新增」：表單就地新增的藝人、系列（新的在前） */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ list: await listAdditions() }, 200, { "Cache-Control": "no-store" });
}

/** { id, action: confirm｜unconfirm｜rename（name, year）｜merge（into） } */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "BAD_REQUEST", "參數不對");
  const action = str(b.action);
  return handle(async () => {
    if (action === "confirm" || action === "unconfirm") {
      await confirmAddition(s.user, id, action === "confirm");
      return json({ ok: true });
    }
    if (action === "rename") return json(await renameAddition(s.user, b.type, b.ref, b.name, b.year, b.region));
    if (action === "merge") return json(await mergeAddition(s.user, id, b.into));
    return fail(400, "BAD_REQUEST", "參數不對");
  });
}
