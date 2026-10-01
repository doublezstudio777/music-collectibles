// 條款同意（2026-10-01 法務修正 M2）。
// - 註冊：表單必勾，伺服器檢查 agreeTerms＋termsVersion（register/route.ts 呼叫 recordConsent）
// - 舊會員：users.terms_version 比 TERMS_REQUIRED 舊時（小版本更新不算，lib/legal.ts），前端跳補同意視窗（components/terms-consent.tsx）；
//   沒同意前可以瀏覽，發布、出價、投稿、編輯資料的 API 用 requireConsented 擋（403 TERMS_REQUIRED，前端收到就開視窗）
// - 每次同意另記一列 terms_consents（只增不改），users 上的兩欄是最新狀態

import { getDb } from "@/db";
import { termsConsents, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fail, requireUser, type User } from "@/lib/server/auth";
import { TERMS_REQUIRED, TERMS_VERSION, termsAccepted } from "@/lib/legal";

/** 同意過的版本 ≥ TERMS_REQUIRED（小版本更新不強制重新同意，2026-10-01） */
export const termsOk = (u: Pick<User, "termsVersion">) => termsAccepted(u.termsVersion);

/** 記下同意（via：register｜update）。版本不是現行版就不收 */
export async function recordConsent(userId: string, version: unknown, via: "register" | "update") {
  if (version !== TERMS_VERSION) return false;
  const at = new Date().toISOString();
  const db = getDb();
  await db.batch([
    db.update(users).set({ termsVersion: TERMS_VERSION, termsAcceptedAt: at }).where(eq(users.id, userId)),
    db.insert(termsConsents).values({ userId, version: TERMS_VERSION, via, createdAt: at }),
  ]);
  return true;
}

export const termsRequired = () =>
  fail(403, "TERMS_REQUIRED", "使用條款與隱私權政策已更新，同意後才能發布、出價或投稿", { version: TERMS_VERSION, required: TERMS_REQUIRED });

/** 需要登入＋已同意現行條款的寫入端點用這個（發布、出價、投稿、編輯資料） */
export async function requireConsented(req: Request): Promise<{ user: User; sessionId: string } | Response> {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  if (!termsOk(s.user)) {
    // 先把 body 讀完再回錯誤：本機 Miniflare 沒讀完 body 就回應，同一條連線的下一個請求會 503（PM記憶 2026-09-27）
    await req.arrayBuffer().catch(() => undefined);
    return termsRequired();
  }
  return s;
}
