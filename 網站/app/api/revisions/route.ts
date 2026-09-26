import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { edit, history, isLocked, loadPage, parseWikiTarget } from "@/lib/server/wiki";

/** 編輯歷史：?target=artist:{slug}｜series:{slug}/{no}（新到舊） */
export async function GET(req: Request) {
  const t = parseWikiTarget(new URL(req.url).searchParams.get("target"));
  if (!t) return fail(400, "BAD_REQUEST", "參數不對");
  const page = await loadPage(t);
  if (!page) return fail(404, "NOT_FOUND", "找不到這個頁面");
  return json({ locked: await isLocked(t), wikiUrl: page.wikiUrl, revisions: await history(t, page) });
}

/** 編輯：{ target, content: string[]（一段一個）, summary（必填）, baseId（開始編輯時的最新版本 id） } */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await edit(s.user, b.target, b.content, b.summary, b.baseId), 201));
}
