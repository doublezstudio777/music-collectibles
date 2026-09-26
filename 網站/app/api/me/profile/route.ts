import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { fail, json, publicMe, readBody, requireUser, str } from "@/lib/server/auth";

/** 改顯示名稱、簡介：{ name?, bio? } */
export async function PATCH(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  const patch: { name?: string; bio?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
  if (b.name !== undefined) {
    const name = str(b.name);
    if (!name || Array.from(name).length > 30) return fail(400, "INVALID", "顯示名稱 1～30 字");
    patch.name = name;
  }
  if (b.bio !== undefined) {
    const bio = str(b.bio);
    if (Array.from(bio).length > 160) return fail(400, "INVALID", "簡介最多 160 字");
    patch.bio = bio;
  }
  const [u] = await getDb().update(users).set(patch).where(eq(users.id, s.user.id)).returning();
  return json({ user: publicMe(u) });
}
