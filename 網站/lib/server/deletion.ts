// 刪除帳號：申請制（2026-09-28 使用者定案的折衷）。
//
// 會員：設定頁小連結「申請刪除帳號」→ 填原因送出，不會立刻刪除，帳號照常可用、可以取消。
// 管理員：後台「刪帳申請」按「執行」（二次確認：要打出這位會員的帳號名），執行後不能還原：
//   - 刪：Email、密碼、登入狀態（sessions）、驗證碼、國家與活動紀錄（user_geo、user_activity＝所在地區的來源）、
//     跟這個帳號有關的限流與每日計數、改名紀錄、大頭貼
//   - 改：暱稱→「已刪除的會員」、帳號名→不可辨識的代號 del-xxxxxxxxxx、簡介清空、status=deleted
//     （Email 欄位不能是空的也不能重複，改成 {代號}@deleted.invalid；這個網域保證收不到信）
//   - 保留：炫收藏、編輯紀錄、留言、出價、私訊、成交紀錄（成交統計的數字）、讚、我有／想要、分數
//   - 照片預設保留；勾「連同照片一起刪除」（本人明確要求時用）才把他上傳的照片從 R2 刪掉、容量扣回
//   - 舊的後台操作紀錄 target=user:{舊帳號名} 改成新代號（紀錄本身保留）
// 全部 D1 寫入放在同一個 batch（同一個交易），中途失敗整批不生效；R2 刪檔在交易成功後做。
//
// 2026-10-01 法務修正（M6）：
//   - 會員申請時自己選要不要一併刪除照片（delete_photos 在申請當下寫入，管理員執行時預設照會員的選擇）
//   - 處理期限 30 日（個資法第 13 條第 2 項），後台顯示期限、逾期標紅
//   - 保留的收藏照片浮水印還印著原帳號名：執行後 result.reburnPending 記下張數，管理員跑
//     `python3 scripts/reburn-watermark.py --remote --deletion {id}` 從原圖重燒成匿名代號，跑完寫 reburned_at。
//     沒有要重燒的照片時，執行當下就寫 reburned_at
//   - 刪掉這位會員的封鎖名單（他封鎖了誰）；別人封鎖他的紀錄屬於別人，保留

import { env } from "cloudflare:workers";
import { destroyAllSessions, type User } from "@/lib/server/auth";
import { randomToken } from "@/lib/server/crypto";
import { DELETED_NAME } from "@/lib/server/names";
import { photoCache, photoCacheKey, releaseBytes } from "@/lib/server/photos";
import { HttpError } from "@/lib/server/trade";
import { DELETION_DAYS } from "@/lib/legal";

export const REASON_MAX = 500;

export async function requestDeletion(u: User, reason: unknown, deletePhotos: unknown = false) {
  const text = typeof reason === "string" ? reason.trim().slice(0, REASON_MAX) : "";
  if (!text) throw new HttpError(400, "INVALID", "寫一下想刪除帳號的原因");
  const db = env.DB!;
  const cur = await db.prepare(`SELECT id FROM deletion_requests WHERE user_id = ?1 AND status = 'pending' LIMIT 1`).bind(u.id).first();
  if (cur) throw new HttpError(409, "ALREADY_REQUESTED", "已經送出申請，管理員處理中");
  const at = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO deletion_requests (user_id, reason, created_at, delete_photos) VALUES (?1, ?2, ?3, ?4)`).bind(u.id, text, at, deletePhotos === true ? 1 : 0),
    db.prepare(`UPDATE users SET deletion_requested_at = ?1 WHERE id = ?2`).bind(at, u.id),
  ]);
  return { requestedAt: at };
}

export async function cancelDeletion(u: User) {
  const db = env.DB!;
  const at = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE deletion_requests SET status = 'cancelled', handled_at = ?1, handled_by = ?2 WHERE user_id = ?2 AND status = 'pending'`).bind(at, u.id),
    db.prepare(`UPDATE users SET deletion_requested_at = NULL WHERE id = ?1`).bind(u.id),
  ]);
}

export async function pendingDeletionCount() {
  const r = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM deletion_requests WHERE status = 'pending'`).first<{ n: number }>();
  return r?.n ?? 0;
}

export type DeletionRow = {
  id: number;
  status: string;
  reason: string;
  createdAt: string;
  handledAt: string | null;
  deletePhotos: boolean;
  result: Record<string, number>;
  /** 處理期限（申請後 30 日） */
  dueAt: string;
  /** 待處理且已過期限 */
  overdue: boolean;
  /** 保留照片的浮水印已重燒成匿名代號的時間；null＝還沒（result.reburnPending 張待重燒） */
  reburnedAt: string | null;
  user: { id: string; handle: string; name: string; email: string; createdAt: string; posts: number; photos: number; photoBytes: number };
};

/** 待處理＋最近 30 筆已處理（管理員用） */
export async function deletionList(): Promise<DeletionRow[]> {
  const r = await env
    .DB!.prepare(
      `SELECT d.id, d.status, d.reason, d.created_at AS createdAt, d.handled_at AS handledAt, d.delete_photos AS dp, d.result, d.reburned_at AS reburnedAt,
              u.id AS uid, u.handle, u.name, u.email, u.created_at AS uCreated,
              (SELECT COUNT(*) FROM shares s WHERE s.author_id = u.id AND s.deleted_at IS NULL) AS posts,
              (SELECT COUNT(*) FROM photos p WHERE p.owner_id = u.id AND p.deleted_at IS NULL AND p.purpose != 'avatar') AS photos,
              (SELECT COALESCE(SUM(bytes), 0) FROM photos p WHERE p.owner_id = u.id AND p.deleted_at IS NULL AND p.purpose != 'avatar') AS photoBytes
       FROM deletion_requests d JOIN users u ON u.id = d.user_id
       WHERE d.status = 'pending' OR (d.status = 'done' AND d.reburned_at IS NULL)
          OR d.id IN (SELECT id FROM deletion_requests WHERE status != 'pending' ORDER BY id DESC LIMIT 30)
       ORDER BY (d.status = 'pending') DESC, d.id DESC`,
    )
    .all<{
      id: number; status: string; reason: string; createdAt: string; handledAt: string | null; dp: number; result: string; reburnedAt: string | null;
      uid: string; handle: string; name: string; email: string; uCreated: string; posts: number; photos: number; photoBytes: number;
    }>();
  return (r.results ?? []).map((x) => ({
    id: x.id,
    status: x.status,
    reason: x.reason,
    createdAt: x.createdAt,
    handledAt: x.handledAt,
    deletePhotos: x.dp === 1,
    result: safeJson(x.result),
    dueAt: new Date(Date.parse(x.createdAt) + DELETION_DAYS * 86400_000).toISOString(),
    overdue: x.status === "pending" && Date.parse(x.createdAt) + DELETION_DAYS * 86400_000 < Date.now(),
    reburnedAt: x.reburnedAt,
    user: { id: x.uid, handle: x.handle, name: x.name, email: x.email, createdAt: x.uCreated, posts: x.posts, photos: x.photos, photoBytes: x.photoBytes },
  }));
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s) as Record<string, number>;
  } catch {
    return {};
  }
};

/**
 * 執行刪除。confirm 必須等於這位會員目前的帳號名（二次確認）。回傳各表清掉幾列、刪了幾個 R2 檔
 */
export async function executeDeletion(admin: User, id: number, deletePhotos: boolean, confirm: string, origin: string) {
  const db = env.DB!;
  const req = await db
    .prepare(`SELECT d.id, d.status, d.user_id AS uid, u.handle, u.email, u.status AS ustatus FROM deletion_requests d JOIN users u ON u.id = d.user_id WHERE d.id = ?1`)
    .bind(id)
    .first<{ id: number; status: string; uid: string; handle: string; email: string; ustatus: string }>();
  if (!req) throw new HttpError(404, "NOT_FOUND", "找不到這筆申請");
  if (req.status !== "pending") throw new HttpError(409, "DONE", "這筆申請已經處理過");
  if (req.ustatus === "deleted") throw new HttpError(409, "DONE", "這個帳號已經刪除");
  if (req.uid === admin.id) throw new HttpError(403, "FORBIDDEN", "不能刪除自己的帳號");
  if (confirm !== req.handle) throw new HttpError(400, "CONFIRM", `確認欄要打出帳號名「${req.handle}」`);

  const uid = req.uid;
  const code = `del-${randomToken(12).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10).padEnd(10, "0")}`;
  const at = new Date().toISOString();
  // 要刪的檔：大頭貼一律刪（屬於個人識別），其他照片只在勾選時刪
  const files = (
    await db
      .prepare(
        `SELECT id, r2_key AS a, thumb_key AS b, og_key AS c, orig_key AS o, bytes, purpose FROM photos
         WHERE owner_id = ?1 AND deleted_at IS NULL AND (purpose = 'avatar' OR ?2 = 1)`,
      )
      .bind(uid, deletePhotos ? 1 : 0)
      .all<{ id: string; a: string; b: string; c: string | null; o: string | null; bytes: number; purpose: string }>()
  ).results ?? [];
  // 藝人照片投稿（2026-09-28）：待審的一律刪；使用中或被替換下來的只在勾選時刪（CC 授權已給出（舊投稿 BY-SA、2026-09-30 起 BY-NC-ND），不勾就保留，標示改成「已刪除的會員」）
  const artistFiles = (
    await db
      .prepare(
        `SELECT id, r2_key AS a, thumb_key AS b, NULL AS c, NULL AS o, bytes, 'artist' AS purpose FROM artist_photos
         WHERE submitter_id = ?1 AND (status = 'pending' OR (?2 = 1 AND status IN ('active', 'retired')))`,
      )
      .bind(uid, deletePhotos ? 1 : 0)
      .all<{ id: number; a: string; b: string; c: string | null; o: string | null; bytes: number; purpose: string }>()
  ).results ?? [];
  const avatarFiles = files.filter((f) => f.purpose === "avatar").length;
  // 保留下來、浮水印要重燒成匿名代號的收藏照片（勾了連同照片刪除就是 0）
  const kept = deletePhotos
    ? 0
    : ((await db.prepare(`SELECT COUNT(*) AS n FROM photos WHERE owner_id = ?1 AND deleted_at IS NULL AND purpose = 'share'`).bind(uid).first<{ n: number }>())?.n ?? 0);
  const likeUid = `%${uid.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const stmts = [
    db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(uid),
    db.prepare(`DELETE FROM email_codes WHERE user_id = ?1`).bind(uid),
    db.prepare(`DELETE FROM user_geo WHERE user_id = ?1`).bind(uid),
    db.prepare(`DELETE FROM user_activity WHERE user_id = ?1`).bind(uid),
    db.prepare(`DELETE FROM rate_limits WHERE key LIKE ?1 ESCAPE '\\' OR key IN (?2, ?3)`).bind(likeUid, `login:${req.email}`, `forgot-email:${req.email}`),
    db.prepare(`DELETE FROM counters WHERE key LIKE ?1 ESCAPE '\\'`).bind(likeUid),
    db.prepare(`DELETE FROM user_name_changes WHERE user_id = ?1`).bind(uid),
    db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ?1`).bind(uid),
    db.prepare(`UPDATE photos SET deleted_at = ?1 WHERE id IN (SELECT value FROM json_each(?2))`).bind(at, JSON.stringify(files.map((f) => f.id))),
    db.prepare(`UPDATE admin_log SET target = ?1 WHERE target = ?2`).bind(`user:${code}`, `user:${req.handle}`),
    db
      .prepare(`UPDATE artist_photos SET status = 'deleted', handled_at = ?1, handled_by = ?2, note = '刪除帳號' WHERE id IN (SELECT value FROM json_each(?3))`)
      .bind(at, admin.id, JSON.stringify(artistFiles.map((f) => f.id))),
    db
      .prepare(
        `UPDATE users SET email = ?1, email_verified_at = NULL, password_hash = '!deleted', handle = ?2, name = ?3, bio = '', links = '{}', fav_artists = '[]',
                name_key = NULL, name_changed_at = NULL, avatar_key = NULL, status = 'deleted', deleted_at = ?4,
                deletion_requested_at = NULL, updated_at = ?4
         WHERE id = ?5`,
      )
      .bind(`${code}@deleted.invalid`, code, DELETED_NAME, at, uid),
  ];
  const out = await db.batch(stmts);
  const n = (i: number) => out[i].meta.changes ?? 0;
  const result = {
    sessions: n(0),
    emailCodes: n(1),
    userGeo: n(2),
    userActivity: n(3),
    rateLimits: n(4),
    counters: n(5),
    nameChanges: n(6),
    blocks: n(7),
    photos: files.length - avatarFiles,
    avatars: avatarFiles,
    adminLogRetargeted: n(9),
    artistPhotos: artistFiles.length,
    reburnPending: kept,
  };
  await db.batch([
    db
      .prepare(`UPDATE deletion_requests SET status = 'done', handled_at = ?1, handled_by = ?2, delete_photos = ?3, result = ?4, reburned_at = ?6 WHERE id = ?5`)
      .bind(at, admin.id, deletePhotos ? 1 : 0, JSON.stringify(result), id, kept ? null : at),
    db
      .prepare(`INSERT INTO admin_log (admin_id, action, target, detail) VALUES (?1, '執行刪除帳號', ?2, ?3)`)
      .bind(admin.id, `user:${code}`, JSON.stringify({ request: id, deletePhotos, ...result })),
  ]);
  // 保險：sessions 已在交易裡刪，這裡再呼叫一次共用函式（之後 sessions 有別的清理也一起走）
  await destroyAllSessions(uid);

  // R2：交易成功後才刪檔、扣容量、清這個資料中心的快取（/img/ 先查 D1，已標刪除的照片在任何地方都回 404）
  let r2Deleted = 0;
  let bytes = 0;
  const cache = photoCache();
  for (const f of [...files, ...artistFiles]) {
    const keys = [...new Set([f.a, f.b, ...(f.c ? [f.c] : [])])];
    // 不公開的原圖（2026-09-29）：沒有網址、不用清快取，只刪檔
    if (f.o) {
      await env.PHOTOS?.delete(f.o).catch(() => undefined);
      r2Deleted++;
    }
    for (const k of keys) {
      await env.PHOTOS?.delete(k).catch(() => undefined);
      r2Deleted++;
      if (cache) await cache.delete(photoCacheKey(origin, k)).catch(() => false);
    }
    bytes += f.bytes;
  }
  if (bytes) await releaseBytes(bytes);
  return { code, ...result, r2Deleted, bytesReleased: bytes };
}
