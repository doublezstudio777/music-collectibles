import { requireConsented } from "@/lib/server/terms";
import { fail, json, readBody } from "@/lib/server/auth";
import { editCollection } from "@/lib/server/collections";
import { handle } from "@/lib/server/trade";

type Ctx = { params: Promise<{ n: string }> };

/** 編輯合集：{ story, customTitle?, tags }（標記整份換掉）。照片走 PUT /api/shares/{n}/photos */
export async function PUT(req: Request, { params }: Ctx) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n <= 0) return fail(400, "BAD_REQUEST", "參數不對");
  const body = await readBody(req);
  return handle(async () => json(await editCollection(s.user, n, body)));
}
