// 收藏榮譽榜（2026-09-29）：只讀每日計分排程算好的 rankings 表，請求當下不計算。
import { env } from "cloudflare:workers";
import { levelOf } from "@/lib/levels";
import { avatarUrl } from "@/lib/server/auth";

/** 上榜人數不到這個數的榜單整個不顯示 */
export const RANK_MIN = 5;

export type Board = "month" | "total" | "fakebuster" | "topfan";
export type RankRow = { pos: number; handle: string; name: string; avatar: string | null; badge: string; points: number; artist?: { slug: string; name: string } };

type Raw = { board: Board; pos: number; points: number; ref: string; period: string; handle: string; name: string; avatar_key: string | null; score: number | null; lv: number | null; artist: string | null };

/** 四張榜；不到 RANK_MIN 人的是 null。period＝本月榜的月份（YYYY-MM） */
export async function rankingBoards() {
  const r = await env
    .DB!.prepare(
      `SELECT k.board, k.pos, k.points, k.ref, k.period, u.handle, u.name, u.avatar_key, s.score, o.level AS lv, a.name AS artist
       FROM rankings k JOIN users u ON u.id = k.user_id
       LEFT JOIN user_scores s ON s.user_id = k.user_id
       LEFT JOIN level_overrides o ON o.user_id = k.user_id
       LEFT JOIN artists a ON k.board = 'topfan' AND a.slug = k.ref
       ORDER BY k.board, k.pos`,
    )
    .all<Raw>();
  const rows = r.results ?? [];
  const pick = (b: Board): RankRow[] =>
    rows
      .filter((x) => x.board === b)
      .map((x) => ({
        pos: x.pos,
        handle: x.handle,
        name: x.name,
        avatar: avatarUrl(x.avatar_key),
        badge: levelOf(x.score ?? 0, x.lv).label,
        points: x.points,
        ...(b === "topfan" ? { artist: { slug: x.ref, name: x.artist ?? x.ref } } : {}),
      }));
  const people = (l: RankRow[]) => new Set(l.map((x) => x.handle)).size;
  const show = (l: RankRow[]) => (people(l) >= RANK_MIN ? l : null);
  const topfan = pick("topfan").sort((a, b) => a.artist!.name.localeCompare(b.artist!.name, "zh-Hant-TW") || a.pos - b.pos);
  return {
    period: rows.find((x) => x.board === "month")?.period ?? "",
    month: show(pick("month")),
    total: show(pick("total")),
    fakebuster: show(pick("fakebuster")),
    topfan: show(topfan),
  };
}

/** 個人頁「本月第 N 名」：本月榜有顯示（滿 RANK_MIN 人）且本人在榜上才回名次 */
export async function monthRank(userId: string) {
  const r = await env
    .DB!.prepare(`SELECT (SELECT pos FROM rankings WHERE board = 'month' AND user_id = ?1) AS pos, (SELECT COUNT(DISTINCT user_id) FROM rankings WHERE board = 'month') AS n`)
    .bind(userId)
    .first<{ pos: number | null; n: number }>();
  return r && r.pos && r.n >= RANK_MIN ? r.pos : null;
}
