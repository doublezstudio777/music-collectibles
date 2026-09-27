import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userNameChanges, users } from "@/db/schema";
import { fail, isAdmin, json, publicMe, readBody, requireUser, str } from "@/lib/server/auth";
import { NAME_CHANGE_DAYS, nameKey, nameProblem, nextNameChange } from "@/lib/server/names";

/**
 * 改暱稱、簡介：{ name?, bio? }
 * 暱稱（2026-09-28）：全站唯一（忽略大小寫、空白、全形半形）、保留字不能用、每 30 天改一次；
 * 改名寫一筆 user_name_changes（只有管理員看得到）。users 有內容版本觸發器，改名後整頁快取自動換新
 */
export async function PATCH(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  const at = new Date().toISOString();
  const patch: { name?: string; nameKey?: string; nameChangedAt?: string; bio?: string; updatedAt: string } = { updatedAt: at };
  let renamed = false;
  if (b.name !== undefined) {
    const name = str(b.name);
    if (name !== s.user.name) {
      const next = nextNameChange(s.user.nameChangedAt);
      if (next) {
        return fail(429, "NAME_CHANGE_LIMIT", `暱稱每 ${NAME_CHANGE_DAYS} 天只能改一次，${twDate(next)} 以後可以再改`, { nextAt: next });
      }
      const np = await nameProblem(name, { max: 30, except: s.user.id, admin: isAdmin(s.user) });
      if (np) return fail(np.code === "NAME_TAKEN" ? 409 : 400, np.code, np.message);
      patch.name = name;
      patch.nameKey = nameKey(name);
      patch.nameChangedAt = at;
      renamed = true;
    }
  }
  if (b.bio !== undefined) {
    const bio = str(b.bio);
    if (Array.from(bio).length > 160) return fail(400, "INVALID", "簡介最多 160 字");
    patch.bio = bio;
  }
  // 什麼都沒變就不寫（寫 users 會讓整頁快取作廢）
  if (Object.keys(patch).length === 1) return json({ user: publicMe(s.user) });
  const db = getDb();
  const [u] = await db.update(users).set(patch).where(eq(users.id, s.user.id)).returning();
  if (renamed) await db.insert(userNameChanges).values({ userId: s.user.id, oldName: s.user.name, newName: patch.name! });
  return json({ user: publicMe(u) });
}

/** 台灣日期 2026-10-28 */
const twDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);
