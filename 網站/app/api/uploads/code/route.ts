import { requireConsented } from "@/lib/server/terms";
import { fail, json } from "@/lib/server/auth";
import { issueVerifyCode } from "@/lib/server/verify";

/**
 * 查證碼發號（2026-09-29）：瀏覽器燒浮水印前先拿一組，燒好後跟照片一起送回 /api/uploads。
 * 每人每天上限見 CODE_DAILY（上傳每天 30 張，留給重試的空間）。
 */
export async function POST(req: Request) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const r = await issueVerifyCode(s.user.id);
  if (!r.ok) return fail(r.status, r.code, r.message);
  return json({ code: r.value }, 201);
}
