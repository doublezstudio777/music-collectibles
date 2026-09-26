import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { verifyPassword } from "@/lib/server/crypto";

/**
 * 刪除帳號：這輪只做「申請」（確認流程：打帳號名＋密碼），記下 deletion_requested_at，帳號照常可用。
 * 實際刪不刪、刪哪些（炫收藏照片、出價紀錄、私訊、檢舉）的策略需要使用者確認，
 * 見 產出/20260927_第2階段技術設計.md 第十五節。
 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  if (b.handle !== s.user.handle) return fail(400, "INVALID", "帳號名不對");
  if (!(await verifyPassword(typeof b.password === "string" ? b.password : "", s.user.passwordHash))) {
    return fail(400, "WRONG_PASSWORD", "密碼不對");
  }
  const at = new Date().toISOString();
  await getDb().update(users).set({ deletionRequestedAt: at }).where(eq(users.id, s.user.id));
  return json({ ok: true, requestedAt: at });
}

/** 取消刪除申請 */
export async function DELETE(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  await getDb().update(users).set({ deletionRequestedAt: null }).where(eq(users.id, s.user.id));
  return json({ ok: true });
}
