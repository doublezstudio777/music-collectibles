import { currentUser, fail, json, readBody, sameOrigin } from "@/lib/server/auth";
import { dismissNotice } from "@/lib/server/notice";
import { TERMS_NOTICE } from "@/lib/legal";

/**
 * 關掉條款更新公告（2026-10-03）：{ version }，只收現在公告的那一版。
 * - 每個人：回一個第一方 cookie lmb_tn=版本（伺服器發的，iPhone Safari 不會 7 天就清；前端讀得到，所以不設 HttpOnly）
 * - 登入會員：另外記在 user_notices，換裝置、換瀏覽器也不再出現
 */
export async function POST(req: Request) {
  const b = await readBody(req);
  if (!sameOrigin(req)) return fail(403, "BAD_ORIGIN", "請從網站操作");
  const v = typeof b.version === "string" ? b.version : "";
  if (!TERMS_NOTICE || v !== TERMS_NOTICE.version) return fail(400, "BAD_REQUEST", "參數不對");
  const s = await currentUser(req);
  if (s) await dismissNotice(s.user.id, v);
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return json({ ok: true }, 200, { "Set-Cookie": `lmb_tn=${encodeURIComponent(v)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`, "Cache-Control": "no-store" });
}
