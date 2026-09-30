import { requireConsented } from "@/lib/server/terms";
import { currentUser, json, readBody } from "@/lib/server/auth";
import { listComments, postComment } from "@/lib/server/comments";
import { handle } from "@/lib/server/trade";

/**
 * 單則炫收藏的留言（2026-09-28）。不在整頁快取裡：頁面載入後前端另外打這支（跟 /api/counts 一樣）。
 * GET ?share={n}：留言列表＋自己能不能刪、檢舉過沒。不快取
 * POST { share, body }：已驗證 Email 才能留言；每分鐘 3 則、每天 50 則
 */
export async function GET(req: Request) {
  const no = Number(new URL(req.url).searchParams.get("share"));
  const s = await currentUser(req);
  return handle(async () => json(await listComments(no, s?.user ?? null), 200, { "Cache-Control": "no-store" }));
}

export async function POST(req: Request) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => json(await postComment(s.user, b.share, b.body), 201));
}
