// 等級與分數（2026-09-28）。
//
// 做法：每一筆加減分都是 score_events 的一列（事件表），排程每天彙總一次（worker.ts 的 scheduled，
// 跟清理過期紀錄同一個 Cron），個人頁顯示「分數統計於某時間」。按讚、留言、發文這些動作本身不寫任何計分資料，
// 由排程從原始資料表補出事件；只有「編輯頁面」與「補上缺漏資料」在動作當下記一筆（要算改了多少字、誰補的）。
// 三張計分表都不掛內容版本觸發器，計分不會讓整頁快取失效。
//
// 彙總幾乎全在 D1 裡用 SQL 跑（一次 batch），Worker 本身只組字串，不吃 CPU 額度。
//
// 分數規則（數值就是下面的常數）：
// - 編輯藝人頁、系列頁：有效編輯 +20，改動 200 字以上 +30；不設每日上限。7 天後入帳，7 天內被還原不給分
//   「極小修改」：去掉所有空白、標點、符號後比對，改動不到 10 個字不給分（只改標點、空白＝0 字）
//   同一人在同一頁連續編輯（中間沒有別人改、間隔 60 分鐘內）合併成一次，依合併後的總改動算分
//   「還原」本身不給分
// - 新增系列、品項、版本並經核准：+15（管理員新增的直接生效）。品項連帶送出的第一個版本不另外算
// - 發炫收藏（含照片）：+10，每日上限 5 則；勾選「可當辨識參考」再 +5（那則收藏有算分才算）
// - 補上缺漏資料：+10，每日上限 5 次，7 天後入帳，7 天內被改掉不給分；補自己新增的不算。
//   可補的欄位（原本空白才能補）：系列發行年；版本的發行年、地區、發行、包裝、內容物、曲目、目錄號、辨識特徵（FILL_FIELDS）
// - 收到讚：+1，每則收藏最多計 50；自己讚自己不算
// - 留言：+2，每日上限 10 則；在自己的收藏底下留言不算
// - 收到留言：+1（給收藏的作者），每則收藏最多計 50 則；在自己的收藏底下留言不算；留言被刪除或隱藏就扣回
// - 按讚：+1，每日上限 10 次；讚自己的不算
// - 成交：買賣雙方各 +5
// - 檢舉成立：+10，7 天後入帳。成立＝管理員維持鎖定、或達門檻且沒被解鎖、或收藏被管理員下架；
//   留言＝被檢舉自動隱藏且沒被恢復、或被管理員刪除。只算成立之前送出的檢舉（成立後才跟上的不算）
// - 檢舉被判不成立（管理員解鎖、留言被管理員恢復）：-5
// 防刷分：
// - 內容被檢舉成立、被隱藏、被刪除，那筆分數作廢（已入帳的也扣回）；取消讚、刪留言同樣作廢
// - 同兩個帳號之間：互讚合計最多 20 次、互留言合計最多 10 則（留言者的「留言」與作者的「收到留言」都算這 10 則，
//   超過之後兩邊都不給）、成交各自最多 2 筆有分，超過的不給分
// 停權（2026-09-28 定案，9/28 再定案拿掉分身刷分特例）：分數保留不歸零、照常顯示；停權期間凍結，事件發生時間落在停權期間
// （suspensions 表）的一律不計，恢復後照常。
// - 對方被停權不影響自己已經拿到的分數（舊規則「按讚者被停權就扣回收到讚」取消）；
//   分身刷分不特別處理（使用者 9/28：「我是覺得他真的要刷就給他刷吧」）：對方停權原因不管是什麼，
//   他給的讚、留言、跟他的成交都照算，跟其他停權原因一視同仁。下拉選單仍保留「分身刷分」這個選項，只是不再影響計分
// 時間一律以台灣日期（UTC+8）切「每日」。

import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { artists, counters, levelOverrides, revisions, scoreEvents, series, userScores, userTitles, users } from "@/db/schema";
import { badgeText, levelOf } from "@/lib/levels";
import { FILL_FIELDS, isBlank, type FillField } from "@/lib/fill";

export { FILL_FIELDS };
import { isAdmin, type User } from "@/lib/server/auth";
import { threshold } from "@/lib/server/content";
import { hit } from "@/lib/server/services";
import { HttpError } from "@/lib/server/trade";

export const POINTS = {
  edit: 20,
  editBig: 30,
  create: 15,
  share: 10,
  ref: 5,
  fill: 10,
  likeRecv: 1,
  likeGive: 1,
  comment: 2,
  commentRecv: 1,
  deal: 5,
  reportOk: 10,
  reportBad: -5,
} as const;

export const CAPS = {
  shareDay: 5,
  fillDay: 5,
  commentDay: 10,
  likeGiveDay: 10,
  likeRecvPerShare: 50,
  commentRecvPerShare: 50,
  pairLikes: 20,
  pairComments: 10,
  pairDeals: 2,
} as const;

/** 改動不到這麼多字＝極小修改 */
export const MINOR_CHARS = 10;
/** 改動這麼多字以上＝大幅編輯 */
export const BIG_CHARS = 200;
/** 同一人同一頁連續編輯合併的間隔 */
export const SESSION_MINUTES = 60;
/** 編輯、補資料、檢舉成立的入帳等待期 */
export const HOLD_DAYS = 7;
export const TITLE_FAKEBUSTER_MIN = 5;

const RUN_KEY = "score_run_at";
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400_000).toISOString();

/* ---------- 編輯的改動量 ---------- */

/** 去掉空白、標點、符號後的字（以 Unicode 字元算） */
const normChars = (paras: string[]) => Array.from(paras.join("").replace(/[\s\p{P}\p{S}]/gu, ""));

/**
 * 改了幾個字：兩邊去掉共同的開頭與結尾後，剩下比較長的那段的字數。O(n)，不做逐字 diff（CPU 上限 10ms）。
 * 散在各處的多處修改會被算成「第一處到最後一處之間」，偏多但不會少算真實的改動。
 */
export function changeSize(before: string[], after: string[]) {
  const a = normChars(before);
  const b = normChars(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return Math.max(a.length - p - s, b.length - p - s);
}

export const editPoints = (chars: number) => (chars < MINOR_CHARS ? 0 : chars >= BIG_CHARS ? POINTS.editBig : POINTS.edit);

const parse = (s: string | null | undefined) => {
  try {
    return JSON.parse(s ?? "[]") as string[];
  } catch {
    return [];
  }
};

type EditDetail = { target: string; base: number; first: number; last: number; lastAt: string; chars: number };

/** 編輯寫進 revisions 之後呼叫（還原不呼叫）。算這次（或這一輪連續編輯）改了多少，記一筆待入帳的事件 */
export async function recordEdit(userId: string, target: string, revId: number, content: string[], at: string) {
  const db = getDb();
  const [prev] = await db
    .select({ id: revisions.id, authorId: revisions.authorId, at: revisions.createdAt, content: revisions.content })
    .from(revisions)
    .where(and(eq(revisions.target, target), lt(revisions.id, revId)))
    .orderBy(desc(revisions.id))
    .limit(1);
  if (!prev) return;
  // 同一人連續編輯：併進上一筆還沒入帳的事件
  if (prev.authorId === userId && Date.parse(at) - Date.parse(prev.at) <= SESSION_MINUTES * 60_000) {
    const [e] = await db
      .select()
      .from(scoreEvents)
      .where(
        and(
          eq(scoreEvents.userId, userId),
          eq(scoreEvents.kind, "edit"),
          sql`json_extract(${scoreEvents.detail}, '$.target') = ${target}`,
          sql`json_extract(${scoreEvents.detail}, '$.last') = ${prev.id}`,
        ),
      )
      .limit(1);
    if (e && e.state !== "credited") {
      const d = JSON.parse(e.detail) as EditDetail;
      const [base] = await db.select({ content: revisions.content }).from(revisions).where(eq(revisions.id, d.base));
      const chars = changeSize(parse(base?.content), content);
      const detail: EditDetail = { ...d, last: revId, lastAt: at, chars };
      await db
        .update(scoreEvents)
        .set({ points: editPoints(chars), availableAt: addDays(at, HOLD_DAYS), state: "pending", detail: JSON.stringify(detail) })
        .where(eq(scoreEvents.id, e.id));
      return;
    }
  }
  const chars = changeSize(parse(prev.content), content);
  const detail: EditDetail = { target, base: prev.id, first: revId, last: revId, lastAt: at, chars };
  await db
    .insert(scoreEvents)
    .values({
      userId,
      kind: "edit",
      source: `edit:${revId}`,
      points: editPoints(chars),
      occurredAt: at,
      availableAt: addDays(at, HOLD_DAYS),
      detail: JSON.stringify(detail),
    })
    .onConflictDoNothing();
}

/* ---------- 補上缺漏資料 ---------- */

const yearOk = (year: string) => {
  const max = new Date().getUTCFullYear() + 1;
  if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > max) throw new HttpError(400, "INVALID", `填 1900～${max} 的西元年`);
};

async function recordFill(u: User, source: string, at: string, detail: Record<string, unknown>) {
  await getDb()
    .insert(scoreEvents)
    .values({ userId: u.id, kind: "fill", source, points: POINTS.fill, occurredAt: at, availableAt: addDays(at, HOLD_DAYS), detail: JSON.stringify(detail) })
    .onConflictDoNothing();
}

export async function fillSeriesYear(u: User, rawKey: unknown, rawYear: unknown) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "NOT_VERIFIED", "認證後才能補資料");
  const m = typeof rawKey === "string" ? rawKey.match(/^([a-z0-9-]{1,60})\/(\d{1,6})$/) : null;
  if (!m) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const year = typeof rawYear === "string" ? rawYear.trim() : typeof rawYear === "number" ? String(rawYear) : "";
  yearOk(year);
  const db = getDb();
  const [w] = await db
    .select()
    .from(series)
    .where(and(eq(series.artistSlug, m[1]), eq(series.no, Number(m[2])), eq(series.status, "approved"), sql`${series.deletedAt} IS NULL`, sql`${series.hiddenAt} IS NULL`));
  if (!w) throw new HttpError(404, "NOT_FOUND", "找不到這個系列");
  if (/^\d{4}$/.test(w.year)) throw new HttpError(409, "ALREADY_FILLED", "已經有人補上了");
  if (!(await hit(`fill:${u.id}`, 20, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天補太多次了，明天再來");
  const at = new Date().toISOString();
  // 系列名稱是「年份《名稱》類型」，送出時沒填年份的是「《名稱》類型」，補上時一起改
  const bare = `《${w.title}》${w.seriesType}`;
  const name = w.name === bare ? `${year}${bare}` : w.name;
  const changed = await db
    .update(series)
    .set({ year, name, updatedAt: at, lastEditBy: u.id })
    .where(and(eq(series.id, w.id), eq(series.year, w.year)))
    .returning({ id: series.id });
  if (!changed.length) throw new HttpError(409, "ALREADY_FILLED", "已經有人補上了");
  // 補自己新增的系列不算分
  if (w.createdBy !== u.id) await recordFill(u, `fill:series:${w.id}:year`, at, { series: w.id, field: "year", value: year });
  return { year, name };
}

/** 補版本的空白欄位：key＝「{藝人}/{流水號}#{品項}-{版本}」 */
export async function fillVersionField(u: User, rawKey: unknown, rawField: unknown, rawValue: unknown) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "NOT_VERIFIED", "認證後才能補資料");
  const m = typeof rawKey === "string" ? rawKey.match(/^([a-z0-9-]{1,60})\/(\d{1,6})#([^#-]{1,40})-([^#-]{1,40})$/) : null;
  if (!m || typeof rawField !== "string" || !(rawField in FILL_FIELDS)) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const field = rawField as FillField;
  const f = FILL_FIELDS[field];
  const value = (typeof rawValue === "string" ? rawValue : typeof rawValue === "number" ? String(rawValue) : "").trim();
  if (field === "year") yearOk(value);
  else if (isBlank(field, value)) throw new HttpError(400, "INVALID", `填一下${f.label}`);
  if (value.length > f.max) throw new HttpError(400, "INVALID", `${f.label}最多 ${f.max} 字`);
  const db = env.DB!;
  const v = await db
    .prepare(
      `SELECT v.id, v.created_by AS createdBy, v.${f.col} AS cur FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id
       WHERE w.artist_slug = ?1 AND w.no = ?2 AND i.item_id = ?3 AND v.version_id = ?4
         AND w.status = 'approved' AND i.status = 'approved' AND v.status = 'approved'
         AND w.deleted_at IS NULL AND w.hidden_at IS NULL AND i.deleted_at IS NULL AND i.hidden_at IS NULL AND v.deleted_at IS NULL AND v.hidden_at IS NULL`,
    )
    .bind(m[1], Number(m[2]), m[3], m[4])
    .first<{ id: number; createdBy: string | null; cur: string }>();
  if (!v) throw new HttpError(404, "NOT_FOUND", "找不到這個版本");
  if (!isBlank(field, v.cur)) throw new HttpError(409, "ALREADY_FILLED", "已經有人補上了");
  if (!(await hit(`fill:${u.id}`, 20, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天補太多次了，明天再來");
  const at = new Date().toISOString();
  const r = await db.prepare(`UPDATE versions SET ${f.col} = ?1 WHERE id = ?2 AND ${f.col} = ?3`).bind(value, v.id, v.cur).run();
  if (!r.meta.changes) throw new HttpError(409, "ALREADY_FILLED", "已經有人補上了");
  // 補自己新增的版本不算分
  if (v.createdBy !== u.id) await recordFill(u, `fill:version:${v.id}:${field}`, at, { version: v.id, field, value });
  return { field, value };
}

/* ---------- 彙總 ---------- */

const TW_DAY = (col: string) => `date(${col}, '+8 hours')`;
const PLUS_HOLD = (col: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${col}, '+${HOLD_DAYS} days')`;
/** 某個檢舉對象（share:… item:… version:…）目前是不是被鎖（跟 lib/data.ts isTargetLocked 同一套） */
const LOCKED = (t: string) =>
  `(COALESCE((SELECT decision FROM target_decisions WHERE target = ${t}), '') = 'kept' OR ((SELECT decision FROM target_decisions WHERE target = ${t}) IS NULL AND (SELECT COUNT(*) FROM reports WHERE target = ${t}) >= ?2))`;
const J = (k: string) => `json_extract(e.detail, '$.${k}')`;

// ?1＝現在時間（ISO）、?2＝檢舉門檻、?3＝管理員 Email（JSON 陣列）
const INSERTS = [
  // 發炫收藏、辨識參考
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT author_id, 'share', 'share:' || no, ${POINTS.share}, created_at, created_at, json_object('share', no) FROM shares`,
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT author_id, 'ref', 'ref:' || no, ${POINTS.ref}, created_at, created_at, json_object('share', no) FROM shares WHERE ref_photo = 1`,
  // 新增系列、品項、版本
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT created_by, 'create', 'series:' || id, ${POINTS.create}, created_at, created_at, json_object('type', 'series', 'id', id) FROM series WHERE created_by IS NOT NULL`,
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT created_by, 'create', 'item:' || id, ${POINTS.create}, created_at, created_at, json_object('type', 'item', 'id', id) FROM items WHERE created_by IS NOT NULL`,
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT v.created_by, 'create', 'version:' || v.id, ${POINTS.create}, v.created_at, v.created_at, json_object('type', 'version', 'id', v.id)
   FROM versions v JOIN items i ON i.id = v.item_ref
   WHERE v.created_by IS NOT NULL AND NOT (v.version_id = 'v1' AND i.created_by IS v.created_by)`,
  // 按讚（給讚的人）、收到讚（收藏的作者）
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT l.user_id, 'like_give', 'lg:' || l.user_id || ':' || l.share_no, ${POINTS.likeGive}, l.created_at, l.created_at,
          json_object('share', l.share_no, 'liker', l.user_id, 'peer', s.author_id)
   FROM likes l JOIN shares s ON s.no = l.share_no WHERE s.author_id != l.user_id`,
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT s.author_id, 'like_recv', 'lr:' || l.user_id || ':' || l.share_no, ${POINTS.likeRecv}, l.created_at, l.created_at,
          json_object('share', l.share_no, 'liker', l.user_id, 'peer', l.user_id)
   FROM likes l JOIN shares s ON s.no = l.share_no WHERE s.author_id != l.user_id`,
  // 留言
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT c.author_id, 'comment', 'c:' || c.id, ${POINTS.comment}, c.created_at, c.created_at, json_object('comment', c.id, 'share', c.share_no, 'peer', s.author_id)
   FROM comments c JOIN shares s ON s.no = c.share_no WHERE s.author_id != c.author_id`,
  // 收到留言（收藏的作者）
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT s.author_id, 'comment_recv', 'cr:' || c.id, ${POINTS.commentRecv}, c.created_at, c.created_at, json_object('comment', c.id, 'share', c.share_no, 'peer', c.author_id)
   FROM comments c JOIN shares s ON s.no = c.share_no WHERE s.author_id != c.author_id`,
  // 成交：買賣雙方
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT seller_id, 'deal', 'd:' || id || ':s', ${POINTS.deal}, sold_at, sold_at, json_object('deal', id, 'peer', buyer_id) FROM deals WHERE seller_id != buyer_id`,
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT buyer_id, 'deal', 'd:' || id || ':b', ${POINTS.deal}, sold_at, sold_at, json_object('deal', id, 'peer', seller_id) FROM deals WHERE seller_id != buyer_id`,
  // 檢舉成立（收藏、品項、版本）：成立時間＝管理員維持鎖定的時間、第 N 位檢舉的時間（達門檻）、收藏被下架的時間
  `WITH t AS (SELECT DISTINCT target FROM reports),
   up AS (
     SELECT t.target, COALESCE(
       CASE WHEN d.decision = 'kept' THEN d.decided_at END,
       CASE WHEN d.decision IS NULL THEN (SELECT created_at FROM reports r WHERE r.target = t.target ORDER BY r.id LIMIT 1 OFFSET ?2 - 1) END,
       CASE WHEN COALESCE(d.decision, '') != 'unlocked' AND t.target LIKE 'share:%'
            THEN (SELECT hidden_at FROM shares s WHERE s.no = CAST(substr(t.target, 7) AS INTEGER)) END
     ) AS at
     FROM t LEFT JOIN target_decisions d ON d.target = t.target
   )
   INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT r.reporter_id, 'report_ok', 'rok:' || r.id, ${POINTS.reportOk}, up.at, ${PLUS_HOLD("up.at")}, json_object('report', r.id, 'target', r.target)
   FROM reports r JOIN up ON up.target = r.target WHERE up.at IS NOT NULL AND r.created_at <= up.at`,
  // 檢舉不成立：管理員解鎖
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT r.reporter_id, 'report_bad', 'rbad:' || r.id, ${POINTS.reportBad}, d.decided_at, d.decided_at, json_object('report', r.id, 'target', r.target)
   FROM reports r JOIN target_decisions d ON d.target = r.target AND d.decision = 'unlocked' WHERE r.created_at <= d.decided_at`,
  // 留言的檢舉：自動隱藏沒被恢復＝成立（隱藏時間），被管理員刪除＝成立（刪除時間）
  `WITH up AS (
     SELECT c.id, CASE
       WHEN c.deleted_at IS NULL AND c.hidden_at IS NOT NULL AND c.decision IS NULL THEN c.hidden_at
       WHEN c.deleted_at IS NOT NULL AND c.deleted_by != c.author_id AND c.deleted_by != s.author_id THEN c.deleted_at
     END AS at
     FROM comments c JOIN shares s ON s.no = c.share_no WHERE c.id IN (SELECT comment_id FROM comment_reports)
   )
   INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT cr.reporter_id, 'report_ok', 'crok:' || cr.id, ${POINTS.reportOk}, up.at, ${PLUS_HOLD("up.at")}, json_object('creport', cr.id, 'comment', cr.comment_id)
   FROM comment_reports cr JOIN up ON up.id = cr.comment_id WHERE up.at IS NOT NULL AND cr.created_at <= up.at`,
  // 留言的檢舉不成立：管理員看過決定保留（沒有裁決時間，用第一次統計到的時間）
  `INSERT OR IGNORE INTO score_events (user_id, kind, source, points, occurred_at, available_at, detail)
   SELECT cr.reporter_id, 'report_bad', 'crbad:' || cr.id, ${POINTS.reportBad}, ?1, ?1, json_object('creport', cr.id, 'comment', cr.comment_id)
   FROM comment_reports cr JOIN comments c ON c.id = cr.comment_id WHERE c.decision = 'kept' AND c.deleted_at IS NULL`,
];

/** 每筆事件目前該不該給分：回傳原因（NULL＝不作廢） */
const BASE_REASON = `CASE e.kind
  WHEN 'share' THEN (SELECT CASE WHEN s.deleted_at IS NOT NULL THEN 'deleted' WHEN s.hidden_at IS NOT NULL THEN 'hidden'
      WHEN NOT EXISTS (SELECT 1 FROM photos p WHERE p.share_no = s.no AND p.deleted_at IS NULL) THEN 'no_photo'
      WHEN ${LOCKED("'share:' || s.no")} THEN 'reported' END FROM shares s WHERE s.no = ${J("share")})
  WHEN 'ref' THEN (SELECT CASE WHEN s.ref_photo = 0 THEN 'unchecked' END FROM shares s WHERE s.no = ${J("share")})
  WHEN 'create' THEN CASE ${J("type")}
    WHEN 'series' THEN (SELECT CASE WHEN w.deleted_at IS NOT NULL THEN 'deleted' WHEN w.hidden_at IS NOT NULL THEN 'hidden'
        WHEN w.status != 'approved' THEN 'not_approved' END FROM series w WHERE w.id = ${J("id")})
    WHEN 'item' THEN (SELECT CASE WHEN i.deleted_at IS NOT NULL THEN 'deleted' WHEN i.hidden_at IS NOT NULL THEN 'hidden'
        WHEN i.status != 'approved' THEN 'not_approved'
        WHEN ${LOCKED("'item:' || w.artist_slug || '/' || w.no || '#' || i.item_id")} THEN 'reported' END
        FROM items i JOIN series w ON w.id = i.series_id WHERE i.id = ${J("id")})
    WHEN 'version' THEN (SELECT CASE WHEN v.deleted_at IS NOT NULL THEN 'deleted' WHEN v.hidden_at IS NOT NULL THEN 'hidden'
        WHEN v.status != 'approved' THEN 'not_approved'
        WHEN ${LOCKED("'version:' || w.artist_slug || '/' || w.no || '#' || i.item_id || '-' || v.version_id")} THEN 'reported' END
        FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE v.id = ${J("id")})
    END
  WHEN 'like_give' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM likes l WHERE l.user_id = ${J("liker")} AND l.share_no = ${J("share")}) THEN 'removed' END
  WHEN 'like_recv' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM likes l WHERE l.user_id = ${J("liker")} AND l.share_no = ${J("share")}) THEN 'removed'
      ELSE (SELECT CASE WHEN s.deleted_at IS NOT NULL THEN 'deleted' WHEN s.hidden_at IS NOT NULL THEN 'hidden' WHEN ${LOCKED("'share:' || s.no")} THEN 'reported' END
            FROM shares s WHERE s.no = ${J("share")}) END
  WHEN 'comment' THEN (SELECT CASE WHEN c.deleted_at IS NOT NULL THEN 'deleted' WHEN c.hidden_at IS NOT NULL THEN 'hidden' END FROM comments c WHERE c.id = ${J("comment")})
  WHEN 'comment_recv' THEN (SELECT CASE WHEN c.deleted_at IS NOT NULL THEN 'deleted' WHEN c.hidden_at IS NOT NULL THEN 'hidden' END FROM comments c WHERE c.id = ${J("comment")})
  WHEN 'deal' THEN (SELECT CASE WHEN d.voided_at IS NOT NULL THEN 'voided' END FROM deals d WHERE d.id = ${J("deal")})
  WHEN 'report_ok' THEN CASE WHEN ${J("report")} IS NOT NULL
      THEN CASE WHEN (SELECT decision FROM target_decisions WHERE target = ${J("target")}) = 'unlocked' THEN 'overturned' END
      ELSE (SELECT CASE WHEN c.decision = 'kept' OR (c.deleted_at IS NULL AND c.hidden_at IS NULL) THEN 'overturned' END FROM comments c WHERE c.id = ${J("comment")}) END
  WHEN 'report_bad' THEN CASE WHEN ${J("report")} IS NOT NULL
      THEN CASE WHEN (SELECT decision FROM target_decisions WHERE target = ${J("target")}) IS NOT 'unlocked' THEN 'reinstated' END
      ELSE (SELECT CASE WHEN c.decision IS NOT 'kept' OR c.deleted_at IS NOT NULL THEN 'reinstated' END FROM comments c WHERE c.id = ${J("comment")}) END
  WHEN 'edit' THEN CASE
      WHEN e.points = 0 THEN 'minor'
      WHEN ${J("target")} LIKE 'artist:%' AND NOT EXISTS (SELECT 1 FROM artists a WHERE a.slug = substr(${J("target")}, 8)
          AND a.status = 'approved' AND a.deleted_at IS NULL AND a.hidden_at IS NULL) THEN 'hidden'
      WHEN ${J("target")} LIKE 'series:%' AND NOT EXISTS (SELECT 1 FROM series w WHERE 'series:' || w.artist_slug || '/' || w.no = ${J("target")}
          AND w.status = 'approved' AND w.deleted_at IS NULL AND w.hidden_at IS NULL) THEN 'hidden'
      WHEN EXISTS (SELECT 1 FROM revisions r2 WHERE r2.target = ${J("target")} AND r2.id > ${J("last")} AND r2.created_at <= e.available_at
          AND (r2.reverted_from < ${J("first")} OR r2.content = (SELECT content FROM revisions WHERE id = ${J("base")}))) THEN 'reverted' END
  WHEN 'fill' THEN CASE WHEN ${J("version")} IS NOT NULL
    THEN (SELECT CASE WHEN v.deleted_at IS NOT NULL OR v.hidden_at IS NOT NULL THEN 'hidden'
        WHEN e.state != 'credited' AND CASE ${J("field")} ${Object.entries(FILL_FIELDS)
          .map(([k, f]) => `WHEN '${k}' THEN v.${f.col}`)
          .join(" ")} END IS NOT ${J("value")} THEN 'changed' END FROM versions v WHERE v.id = ${J("version")})
    ELSE (SELECT CASE WHEN w.deleted_at IS NOT NULL OR w.hidden_at IS NOT NULL THEN 'hidden'
      WHEN e.state != 'credited' AND w.year != ${J("value")} THEN 'changed' END FROM series w WHERE w.id = ${J("series")}) END
END`;

/** 停權凍結：事件發生時間落在這個人的停權期間就不計（恢復後的事件照常） */
const REASON = `CASE WHEN EXISTS (SELECT 1 FROM suspensions su WHERE su.user_id = e.user_id AND su.started_at <= e.occurred_at
    AND (su.ended_at IS NULL OR e.occurred_at < su.ended_at)) THEN 'suspended' ELSE (${BASE_REASON}) END`;

const PAIR = `CASE WHEN user_id < json_extract(detail, '$.peer') THEN user_id || '|' || json_extract(detail, '$.peer') ELSE json_extract(detail, '$.peer') || '|' || user_id END`;

/** 算出每筆事件的最終 reason 與 state，只改有變的列 */
const RESOLVE = `UPDATE score_events SET reason = f.r, state = f.st FROM (
  WITH b AS (
    SELECT e.id, e.kind, e.user_id, e.source, e.points, e.occurred_at, e.available_at, e.detail, ${REASON} AS r FROM score_events e
  ),
  -- 上限一律以「全部事件」排名：之後被隱藏、刪除、取消的仍佔名額，扣回才會真的扣到（不會由超額的那筆遞補）
  k AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY kind, ${PAIR} ORDER BY occurred_at, id) AS pair_n,
      ROW_NUMBER() OVER (PARTITION BY kind, user_id, ${PAIR} ORDER BY occurred_at, id) AS pair_user_n,
      ROW_NUMBER() OVER (PARTITION BY kind, json_extract(detail, '$.share') ORDER BY occurred_at, id) AS share_n,
      ROW_NUMBER() OVER (PARTITION BY kind, user_id, ${TW_DAY("occurred_at")} ORDER BY occurred_at, id) AS day_n
    FROM b
  ),
  d AS (
    SELECT *, COALESCE(r,
      CASE WHEN kind IN ('like_give', 'like_recv') AND pair_n > ${CAPS.pairLikes} THEN 'pair_cap'
           WHEN kind IN ('comment', 'comment_recv') AND pair_n > ${CAPS.pairComments} THEN 'pair_cap'
           WHEN kind = 'deal' AND pair_user_n > ${CAPS.pairDeals} THEN 'pair_cap' END,
      CASE WHEN kind = 'like_recv' AND share_n > ${CAPS.likeRecvPerShare} THEN 'share_cap'
           WHEN kind = 'comment_recv' AND share_n > ${CAPS.commentRecvPerShare} THEN 'share_cap' END,
      CASE WHEN kind = 'share' AND day_n > ${CAPS.shareDay} THEN 'daily_cap'
           WHEN kind = 'fill' AND day_n > ${CAPS.fillDay} THEN 'daily_cap'
           WHEN kind = 'comment' AND day_n > ${CAPS.commentDay} THEN 'daily_cap'
           WHEN kind = 'like_give' AND day_n > ${CAPS.likeGiveDay} THEN 'daily_cap' END
    ) AS r4 FROM k
  ),
  x AS (
    SELECT d.id, CASE WHEN d.kind = 'ref' THEN COALESCE(d.r4, s.r4, CASE WHEN s.id IS NULL THEN 'no_share' END) ELSE d.r4 END AS r,
      d.points, d.available_at FROM d LEFT JOIN d s ON d.kind = 'ref' AND s.source = 'share:' || substr(d.source, 5)
  )
  SELECT id, r, CASE WHEN r IS NOT NULL OR points = 0 THEN 'void' WHEN available_at > ?1 THEN 'pending' ELSE 'credited' END AS st FROM x
) AS f WHERE f.id = score_events.id AND (score_events.reason IS NOT f.r OR score_events.state != f.st)`;

const TOTALS = `INSERT INTO user_scores (user_id, score, pending, updated_at)
  SELECT u.id,
    MAX(0, COALESCE(SUM(CASE WHEN e.state = 'credited' THEN e.points END), 0)),
    COALESCE(SUM(CASE WHEN e.state = 'pending' THEN e.points END), 0),
    ?1
  FROM users u JOIN score_events e ON e.user_id = u.id WHERE 1 GROUP BY u.id
  ON CONFLICT(user_id) DO UPDATE SET score = excluded.score, pending = excluded.pending, updated_at = excluded.updated_at
  WHERE user_scores.score != excluded.score OR user_scores.pending != excluded.pending`;

/** 目前該有的稱號：打假先鋒、某某藝人頭號樂迷（有效編輯最多；同分取先達到的） */
const DESIRED_TITLES = `
  WITH ok AS (SELECT u.id FROM users u WHERE u.status = 'active' AND lower(u.email) NOT IN (SELECT lower(value) FROM json_each(?3))),
  fb AS (
    SELECT e.user_id, 'fakebuster' AS kind, '' AS ref FROM score_events e
    WHERE e.kind = 'report_ok' AND e.state = 'credited' AND e.user_id IN (SELECT id FROM ok)
    GROUP BY e.user_id HAVING COUNT(*) >= ${TITLE_FAKEBUSTER_MIN}
  ),
  ed AS (
    SELECT e.user_id, e.occurred_at, CASE WHEN json_extract(e.detail, '$.target') LIKE 'artist:%' THEN substr(json_extract(e.detail, '$.target'), 8)
      ELSE substr(json_extract(e.detail, '$.target'), 8, instr(substr(json_extract(e.detail, '$.target'), 8), '/') - 1) END AS slug
    FROM score_events e WHERE e.kind = 'edit' AND e.state = 'credited' AND e.user_id IN (SELECT id FROM ok)
  ),
  per AS (SELECT slug, user_id, COUNT(*) AS n, MAX(occurred_at) AS reached FROM ed GROUP BY slug, user_id),
  rk AS (SELECT slug, user_id, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY n DESC, reached ASC, user_id) AS rn FROM per)
  SELECT user_id, kind, ref FROM fb
  UNION ALL SELECT user_id, 'topfan', slug FROM rk WHERE rn = 1`;

export type ScoreRun = { at: string; events: number; changed: number; users: number; titles: number };

/** 跑一次彙總（排程每天一次；管理員可以手動觸發）。now 只給本機驗收模擬時間用 */
export async function recomputeScores(now = new Date()): Promise<ScoreRun> {
  const db = env.DB!;
  const at = now.toISOString();
  const th = await threshold();
  const admins = JSON.stringify(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
  // D1 會拒絕帶了但沒用到的參數：每句只綁自己用到的
  const bind = (q: string) => {
    const s = db.prepare(q);
    const n = Math.max(0, ...Array.from(q.matchAll(/\?(\d)/g), (m) => Number(m[1])));
    return n ? s.bind(...[at, th, admins].slice(0, n)) : s;
  };
  const stmts = [
    ...INSERTS.map(bind),
    bind(RESOLVE),
    bind(TOTALS),
    bind(`DELETE FROM user_titles WHERE (user_id, kind, ref) NOT IN (SELECT user_id, kind, ref FROM (${DESIRED_TITLES}))`),
    bind(`INSERT OR IGNORE INTO user_titles (user_id, kind, ref, since) SELECT user_id, kind, ref, ?1 FROM (${DESIRED_TITLES})`),
    db.prepare(`INSERT INTO counters (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(RUN_KEY, now.getTime()),
  ];
  const r = await db.batch(stmts);
  const n = (i: number) => r[i]?.meta.changes ?? 0;
  const k = INSERTS.length;
  return {
    at,
    events: INSERTS.reduce((s, _, i) => s + n(i), 0),
    changed: n(k),
    users: n(k + 1),
    titles: n(k + 2) + n(k + 3),
  };
}

/* ---------- 顯示 ---------- */

/** 上次統計時間（ISO）；還沒跑過是 null */
export async function lastRunAt() {
  const [r] = await getDb().select({ v: counters.value }).from(counters).where(eq(counters.key, RUN_KEY));
  return r ? new Date(r.v).toISOString() : null;
}

/** 暱稱旁的小標籤：id → 「收藏家 Lv.3」／「館長」 */
export async function userBadges(ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return new Map<string, string>();
  // D1 一句最多 100 個參數：每 90 位查一次
  const rows = (
    await Promise.all(
      Array.from({ length: Math.ceil(uniq.length / 90) }, (_, i) =>
        getDb()
          .select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, score: userScores.score, override: levelOverrides.level })
          .from(users)
          .leftJoin(userScores, eq(userScores.userId, users.id))
          .leftJoin(levelOverrides, eq(levelOverrides.userId, users.id))
          .where(inArray(users.id, uniq.slice(i * 90, i * 90 + 90))),
      ),
    )
  ).flat();
  return new Map(rows.map((r) => [r.id, badgeText(r.score ?? 0, isAdmin(r), r.override)]));
}

export type TitleView = { kind: "fakebuster" | "topfan"; label: string; href?: string };

/** 個人頁：分數、等級、離下一級、稱號 */
export async function profileScore(u: User) {
  const db = getDb();
  const [[s], [o], titles, runAt] = await Promise.all([
    db.select().from(userScores).where(eq(userScores.userId, u.id)),
    db.select({ level: levelOverrides.level }).from(levelOverrides).where(eq(levelOverrides.userId, u.id)),
    db.select().from(userTitles).where(eq(userTitles.userId, u.id)),
    lastRunAt(),
  ]);
  const slugs = titles.filter((t) => t.kind === "topfan").map((t) => t.ref);
  const names = slugs.length
    ? new Map((await db.select({ slug: artists.slug, name: artists.name }).from(artists).where(inArray(artists.slug, slugs))).map((a) => [a.slug, a.name]))
    : new Map<string, string>();
  const views: TitleView[] = [
    ...titles.filter((t) => t.kind === "fakebuster").map(() => ({ kind: "fakebuster" as const, label: "打假先鋒" })),
    ...titles
      .filter((t) => t.kind === "topfan" && names.has(t.ref))
      .sort((a, b) => a.since.localeCompare(b.since))
      .map((t) => ({ kind: "topfan" as const, label: `${names.get(t.ref)}頭號樂迷`, href: `/artist/${t.ref}` })),
  ];
  const score = s?.score ?? 0;
  const admin = isAdmin(u);
  // 管理員指定的等級：會員自己看到的就是那個等級，不另外標示
  return { admin, badge: badgeText(score, admin, o?.level), score, pending: s?.pending ?? 0, level: levelOf(score, o?.level), runAt, titles: views };
}
