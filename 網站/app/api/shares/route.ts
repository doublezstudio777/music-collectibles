import { json, readBody, requireUser } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { createShare, handle } from "@/lib/server/trade";

/** 炫收藏列表（新的在前），App 用；?page=1，每頁 24 則 */
export async function GET(req: Request) {
  const page = Math.max(1, Number(new URL(req.url).searchParams.get("page")) || 1);
  const all = (await getCatalog(null)).allShareViews();
  return json({ shares: all.slice((page - 1) * 24, page * 24), total: all.length, page });
}

/** 發布炫收藏：作者是登入的人。必填照片（先 POST /api/uploads 拿 id）、跟誰有關、類型（或系列＋品項） */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  return handle(async () => json({ n: await createShare(s.user, body) }, 201));
}
