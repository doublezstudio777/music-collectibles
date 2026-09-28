// 系列頁的曲目（2026-09-28）：曲目不進整包目錄（目錄每次重建都要讀、要算 CPU），系列頁自己查這一個系列的。

import { env } from "cloudflare:workers";
import { parseJson, userNames } from "@/lib/server/content";

export type VersionTracks = {
  /** 行清單（lib/tracks.ts 格式） */
  lines: string[];
  /** MusicBrainz release MBID（有＝曲目最初由 MusicBrainz 帶入） */
  mbid: string | null;
  /** 最後一次有人工修改（維基式編輯）時才有 */
  editedBy: { name: string; handle: string; date: string } | null;
};

/** 鍵＝`{品項}-{版本}`（跟版本錨點相同） */
export async function seriesTracks(slug: string, no: number): Promise<Map<string, VersionTracks>> {
  const db = env.DB!;
  const [rows, revs] = await Promise.all([
    db
      .prepare(
        `SELECT i.item_id AS item, v.version_id AS ver, v.track_list AS trackList, v.mbid FROM versions v
         JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id
         WHERE w.artist_slug = ?1 AND w.no = ?2 AND v.deleted_at IS NULL AND i.deleted_at IS NULL`,
      )
      .bind(slug, no)
      .all<{ item: string; ver: string; trackList: string; mbid: string | null }>(),
    // 每個版本最新一筆曲目修改（作者是 NULL 的是匯入時的初始版本，不算人工修改）
    db
      .prepare(
        `SELECT r.target, r.author_id AS authorId, r.created_at AS at FROM revisions r
         WHERE r.field = 'tracks' AND r.target >= ?1 AND r.target < ?2
           AND r.id = (SELECT MAX(r2.id) FROM revisions r2 WHERE r2.target = r.target)`,
      )
      .bind(`tracks:${slug}/${no}#`, `tracks:${slug}/${no}#￿`)
      .all<{ target: string; authorId: string | null; at: string }>(),
  ]);
  const names = await userNames(revs.results.flatMap((r) => (r.authorId ? [r.authorId] : [])));
  const edited = new Map(
    revs.results
      .filter((r) => r.authorId)
      .map((r) => {
        const u = names.get(r.authorId!);
        return [r.target.slice(r.target.indexOf("#") + 1), { name: u?.name ?? "（已刪除）", handle: u?.handle ?? "", date: r.at.slice(0, 10) }];
      }),
  );
  return new Map(
    rows.results.map((r) => {
      const k = `${r.item}-${r.ver}`;
      return [k, { lines: parseJson<string[]>(r.trackList, []), mbid: r.mbid, editedBy: edited.get(k) ?? null }];
    }),
  );
}
