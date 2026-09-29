// 首頁推薦歌曲（2026-09-29）：首頁上方 Spotify 嵌入播放器的歌單，後台「推薦歌曲」管理。
// 首頁整頁快取：伺服器只輸出整份啟用歌單，隨機挑與「換一首」都在瀏覽器端做；
// 歌單任何變動由 spotify_picks 的觸發器讓 content_version 加 1（遷移 0021），首頁換新快取。
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, artists, spotifyPicks } from "@/db/schema";
import type { User } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/trade";

export type PickRow = typeof spotifyPicks.$inferSelect;

/** 首頁：啟用中的歌（依排序） */
export async function enabledPicks() {
  return getDb()
    .select({ artistSlug: spotifyPicks.artistSlug, trackId: spotifyPicks.trackId })
    .from(spotifyPicks)
    .where(eq(spotifyPicks.enabled, 1))
    .orderBy(asc(spotifyPicks.sort), asc(spotifyPicks.id));
}

/** 貼上的東西 → Spotify 歌曲 ID。收 open.spotify.com/track/…（含 intl-xx、?si=）、spotify:track:…、22 碼 ID */
export function parseTrackId(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s;
  const uri = s.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  try {
    const u = new URL(s);
    if (u.hostname !== "open.spotify.com") return null;
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})\/?$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** 後台清單：全部（含停用），附藝人名 */
export async function adminPicks() {
  const db = getDb();
  const rows = await db.select().from(spotifyPicks).orderBy(asc(spotifyPicks.sort), asc(spotifyPicks.id));
  const names = new Map(
    (await db.select({ slug: artists.slug, name: artists.name }).from(artists).where(eq(artists.kind, "藝人"))).map((a) => [a.slug, a.name]),
  );
  return rows.map((r) => ({ ...r, artistName: names.get(r.artistSlug) ?? r.artistSlug }));
}
export type AdminPick = Awaited<ReturnType<typeof adminPicks>>[number];

/** Spotify oEmbed 查歌名，順便確認這首存在；查不到回 null，連不上回 ""（不擋新增） */
async function oembedTitle(trackId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${trackId}`)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) return "";
    const j = (await r.json()) as { title?: unknown };
    return typeof j.title === "string" ? j.title.slice(0, 200) : "";
  } catch {
    return "";
  }
}

export async function addPick(admin: User, rawUrl: unknown, rawSlug: unknown) {
  const trackId = parseTrackId(rawUrl);
  if (!trackId) throw new HttpError(400, "BAD_URL", "貼 Spotify 歌曲連結（open.spotify.com/track/…）");
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  const db = getDb();
  const [a] = await db
    .select({ slug: artists.slug, name: artists.name })
    .from(artists)
    .where(and(eq(artists.slug, slug), eq(artists.kind, "藝人"), eq(artists.status, "approved")));
  if (!a) throw new HttpError(400, "BAD_ARTIST", "選一位藝人");
  const [dup] = await db
    .select({ id: spotifyPicks.id })
    .from(spotifyPicks)
    .where(and(eq(spotifyPicks.artistSlug, a.slug), eq(spotifyPicks.trackId, trackId)));
  if (dup) throw new HttpError(409, "DUPLICATE", "這首已經在清單裡");
  const title = await oembedTitle(trackId);
  if (title === null) throw new HttpError(404, "NOT_FOUND", "Spotify 查不到這首歌");
  const [max] = await db.select({ m: sql<number>`COALESCE(MAX(${spotifyPicks.sort}), -1)` }).from(spotifyPicks);
  const [row] = await db
    .insert(spotifyPicks)
    .values({ artistSlug: a.slug, trackId, title, sort: (max?.m ?? -1) + 1, createdBy: admin.id })
    .returning();
  await db.insert(adminLog).values({ adminId: admin.id, action: "新增推薦歌曲", target: `artist:${a.slug}`, detail: JSON.stringify({ id: row.id, trackId, title }) });
  return { ...row, artistName: a.name };
}

export async function setPickEnabled(admin: User, id: number, enabled: boolean) {
  const db = getDb();
  const [row] = await db.update(spotifyPicks).set({ enabled: enabled ? 1 : 0 }).where(eq(spotifyPicks.id, id)).returning();
  if (!row) throw new HttpError(404, "NOT_FOUND", "找不到這首");
  await db.insert(adminLog).values({
    adminId: admin.id,
    action: enabled ? "啟用推薦歌曲" : "停用推薦歌曲",
    target: `artist:${row.artistSlug}`,
    detail: JSON.stringify({ id, trackId: row.trackId, title: row.title }),
  });
  return row;
}

export async function removePick(admin: User, id: number) {
  const db = getDb();
  const [row] = await db.delete(spotifyPicks).where(eq(spotifyPicks.id, id)).returning();
  if (!row) throw new HttpError(404, "NOT_FOUND", "找不到這首");
  await db.insert(adminLog).values({
    adminId: admin.id,
    action: "刪除推薦歌曲",
    target: `artist:${row.artistSlug}`,
    detail: JSON.stringify({ id, trackId: row.trackId, title: row.title }),
  });
  return { ok: true };
}
