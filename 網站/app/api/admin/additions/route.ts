import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { confirmAddition, listAdditions, mergeAddition, renameAddition } from "@/lib/server/additions";
import { approvalTarget, markDecision, recheckAutofill, rejectAutofill } from "@/lib/server/autofill";
import { getDb } from "@/db";
import { adminLog, catalogAdditions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { handle, HttpError } from "@/lib/server/trade";

/** 後台「待確認的新增」：表單就地新增的藝人、系列、版本（新的在前），含自動補資料的結果 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ list: await listAdditions() }, 200, { "Cache-Control": "no-store" });
}

/**
 * { id, action }：
 * confirm｜unconfirm｜rename（name, year）｜merge（into）
 * approve：核准。自動補資料判定跟既有資料重複的，核准＝改掛到既有那筆；其他＝確認（預填內容保留）
 * reject：駁回預填（還原自動填的欄位、刪掉自動建且沒人用的版本），新增本身留著待確認
 * recheck（hint＝MBID 或條碼，可空白）：還原上次預填後重查
 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return fail(400, "BAD_REQUEST", "參數不對");
  const action = str(b.action);
  const log = (act: string, target: string, detail: Record<string, unknown>) =>
    getDb().insert(adminLog).values({ adminId: s.user.id, action: act, target, detail: JSON.stringify(detail) });
  return handle(async () => {
    if (action === "confirm" || action === "unconfirm") {
      await confirmAddition(s.user, id, action === "confirm");
      if (action === "unconfirm") await markDecision(id, null);
      return json({ ok: true });
    }
    if (action === "rename") return json(await renameAddition(s.user, b.type, b.ref, b.name, b.year, b.region));
    if (action === "merge") {
      const r = await mergeAddition(s.user, id, b.into);
      await markDecision(id, "approved");
      return json(r);
    }
    const [add] = await getDb().select().from(catalogAdditions).where(eq(catalogAdditions.id, id));
    if (!add) throw new HttpError(404, "NOT_FOUND", "找不到這筆");
    if (action === "approve") {
      const into = await approvalTarget(id);
      const r = into ? await mergeAddition(s.user, id, into) : (await confirmAddition(s.user, id, true), { ok: true });
      await markDecision(id, "approved");
      await log("核准自動補資料", `${add.type}:${add.ref}`, into ? { mergedInto: into } : {});
      return json({ ok: true, mergedInto: into, ...r });
    }
    if (action === "reject") {
      const r = await rejectAutofill(id);
      await log("駁回自動補資料", `${add.type}:${add.ref}`, r);
      return json({ ok: true, ...r });
    }
    if (action === "recheck") {
      const r = await recheckAutofill(id, add.type, add.ref, b.hint);
      await log("重查自動補資料", `${add.type}:${add.ref}`, r);
      return json({ ok: true, ...r });
    }
    return fail(400, "BAD_REQUEST", "參數不對");
  });
}
