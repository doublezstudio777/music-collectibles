// 條款更新公告關掉了哪一版（2026-10-03，user_notices）。不寫 users：users 有 cv_users 觸發器，一改就讓全站整頁快取失效
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { userNotices } from "@/db/schema";

/** 讀不到（例如遷移還沒套）回 null，不讓 /api/me 跟著壞 */
export async function noticeSeen(userId: string) {
  try {
    const [r] = await getDb().select({ v: userNotices.version }).from(userNotices).where(eq(userNotices.userId, userId));
    return r?.v ?? null;
  } catch {
    return null;
  }
}

export async function dismissNotice(userId: string, version: string) {
  await getDb()
    .insert(userNotices)
    .values({ userId, version })
    .onConflictDoUpdate({ target: userNotices.userId, set: { version, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` } });
}
