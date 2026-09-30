import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userNameChanges, users } from "@/db/schema";
import { fail, isAdmin, json, publicMe, readBody, requireUser, str } from "@/lib/server/auth";
import { NAME_CHANGE_DAYS, nameKey, nameProblem, nextNameChange } from "@/lib/server/names";
import { getCatalog } from "@/lib/server/content";
import { checkBio, checkLink, FAV_MAX, parseFavs, parseLinks, SOCIALS, type Links } from "@/lib/profile-rules";

/** 設定頁用：自我介紹、社群連結、最喜歡的藝人（藝人帶名字；已隱藏或刪除的不回） */
export async function GET(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const c = await getCatalog();
  const favArtists = parseFavs(s.user.favArtists)
    .map((slug) => c.visibleArtist(slug))
    .filter((a) => a !== undefined)
    .map((a) => ({ slug: a.slug, name: a.name }));
  return json({ bio: s.user.bio, links: parseLinks(s.user.links), favArtists });
}

/**
 * 改暱稱、自我介紹、社群連結、最喜歡的藝人：{ name?, bio?, links?, favArtists? }
 * 自我介紹 200 字保留換行、社群連結網域白名單、藝人最多 5 位（2026-09-30，規則在 lib/profile-rules.ts）
 * 暱稱（2026-09-28）：全站唯一（忽略大小寫、空白、全形半形）、保留字不能用、每 30 天改一次；
 * 改名寫一筆 user_name_changes（只有管理員看得到）。users 有內容版本觸發器，改名後整頁快取自動換新
 */
export async function PATCH(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  const at = new Date().toISOString();
  const patch: {
    name?: string;
    nameKey?: string;
    nameChangedAt?: string;
    bio?: string;
    links?: string;
    favArtists?: string;
    updatedAt: string;
  } = { updatedAt: at };
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
    const r = checkBio(typeof b.bio === "string" ? b.bio : "");
    if (!r.ok) return fail(400, "INVALID_BIO", r.message);
    if (r.bio !== s.user.bio) patch.bio = r.bio;
  }
  if (b.links !== undefined) {
    const src = b.links && typeof b.links === "object" ? (b.links as Record<string, unknown>) : {};
    const links: Links = {};
    for (const x of SOCIALS) {
      const r = checkLink(x.key, typeof src[x.key] === "string" ? (src[x.key] as string) : "");
      if (!r.ok) return fail(400, "INVALID_LINK", r.message, { field: x.key });
      if (r.url) links[x.key] = r.url;
    }
    const v = JSON.stringify(links);
    if (v !== JSON.stringify(parseLinks(s.user.links))) patch.links = v;
  }
  if (b.favArtists !== undefined) {
    const raw = Array.isArray(b.favArtists) ? b.favArtists.filter((x): x is string => typeof x === "string") : [];
    const slugs = [...new Set(raw)];
    if (slugs.length > FAV_MAX) return fail(400, "TOO_MANY", `最喜歡的藝人最多 ${FAV_MAX} 位`);
    const c = await getCatalog();
    if (slugs.some((slug) => !c.visibleArtist(slug))) return fail(400, "UNKNOWN_ARTIST", "有藝人找不到，重新整理再選一次");
    const v = JSON.stringify(slugs);
    if (v !== s.user.favArtists) patch.favArtists = v;
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
