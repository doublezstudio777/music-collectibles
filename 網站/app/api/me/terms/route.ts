import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { recordConsent } from "@/lib/server/terms";

/** 舊會員補同意（2026-10-01）：{ version }，要等於現行版本。記在 users 與 terms_consents */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  if (!(await recordConsent(s.user.id, b.version, "update"))) return fail(409, "TERMS_CHANGED", "使用條款剛更新，重新整理頁面再同意");
  return json({ ok: true });
}
