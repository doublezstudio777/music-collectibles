// 系列頁「資料貢獻者」（2026-09-28）：編輯過系列正文、新增過品項或版本、發過這個系列的炫收藏的會員。
// 一次查詢（UNION ALL 後依會員加總），只在整頁快取沒命中時跑；這些表都有內容版本觸發器，
// 貢獻或停權（users 更新）都會讓頁面換新。停權的帳號不列；匯入時沒有作者的初始版本不算。

import { env } from "cloudflare:workers";

export const CONTRIBUTOR_LIMIT = 10;
export type Contributor = { handle: string; name: string; n: number };

export async function seriesContributors(artistSlug: string, no: number): Promise<{ list: Contributor[]; total: number }> {
  const skey = `${artistSlug}/${no}`;
  const sql = `
    WITH s AS (SELECT id FROM series WHERE artist_slug = ?1 AND no = ?2),
    x AS (
      SELECT author_id AS uid, COUNT(*) AS n, MIN(created_at) AS first FROM revisions
        WHERE target = ?3 AND author_id IS NOT NULL GROUP BY author_id
      UNION ALL
      SELECT i.created_by, COUNT(*), MIN(i.created_at) FROM items i
        WHERE i.series_id IN (SELECT id FROM s) AND i.status = 'approved' AND i.deleted_at IS NULL AND i.hidden_at IS NULL AND i.created_by IS NOT NULL
        GROUP BY i.created_by
      UNION ALL
      SELECT v.created_by, COUNT(*), MIN(v.created_at) FROM versions v JOIN items i ON i.id = v.item_ref
        WHERE i.series_id IN (SELECT id FROM s) AND v.status = 'approved' AND v.deleted_at IS NULL AND v.hidden_at IS NULL AND v.created_by IS NOT NULL
        GROUP BY v.created_by
      UNION ALL
      SELECT author_id, COUNT(*), MIN(created_at) FROM shares
        WHERE series_key = ?4 AND deleted_at IS NULL AND hidden_at IS NULL GROUP BY author_id
    )
    SELECT u.handle AS handle, u.name AS name, SUM(x.n) AS n, MIN(x.first) AS first
      FROM x JOIN users u ON u.id = x.uid
      WHERE u.status = 'active'
      GROUP BY u.id
      ORDER BY n DESC, first ASC, u.handle ASC`;
  const r = await env.DB!.prepare(sql).bind(artistSlug, no, `series:${skey}`, skey).all<{ handle: string; name: string; n: number }>();
  const rows = r.results ?? [];
  return { list: rows.slice(0, CONTRIBUTOR_LIMIT).map((x) => ({ handle: x.handle, name: x.name, n: Number(x.n) })), total: rows.length };
}
