// 照片查證碼（2026-09-29）：每張收藏照片一組 5 碼，燒進浮水印；/verify 輸入這組碼查回原本那則收藏。
// - 發號：photo_codes（code 主鍵，發過的碼不會再發），上傳時照片帶回來，確認是發給這個人、還沒用過才掛到 photos.verify_code
// - 查詢：同一個 IP 每小時 VERIFY_HOURLY 次（rate_limits，跟註冊、重寄驗證碼同一套），防止逐碼亂猜
// - 露出多少：收藏公開中才給縮圖、標題、發布日期；收藏下架（隱藏、刪除、被檢舉鎖定、照片刪了）只說是哪位會員的；
//   會員已刪帳號只說「已刪除的會員」

import { env } from "cloudflare:workers";
import { VERIFY_CODE_CHARS, VERIFY_CODE_LEN } from "@/lib/data";
import { hit } from "@/lib/server/services";

/** 每人每天最多拿幾組碼 */
export const CODE_DAILY = 90;
/** 同一個 IP 每小時最多查幾次 */
export const VERIFY_HOURLY = 30;

/** 均勻取 5 碼（拒絕取樣，避免模數偏差） */
export function randomVerifyCode() {
  const n = VERIFY_CODE_CHARS.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < VERIFY_CODE_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < VERIFY_CODE_LEN) out += VERIFY_CODE_CHARS[b % n];
    }
  }
  return out;
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; code: string; message: string };

export async function issueVerifyCode(ownerId: string): Promise<Result<string>> {
  const day = new Date().toISOString().slice(0, 10);
  if (!(await hit(`vcode:${ownerId}:${day}`, CODE_DAILY, 86400))) {
    return { ok: false, status: 429, code: "DAILY_LIMIT", message: "今天上傳太多次，明天再來" };
  }
  const db = env.DB!;
  // 31^5 ≈ 2,860 萬組，撞到已發過的就換一組
  for (let i = 0; i < 8; i++) {
    const code = randomVerifyCode();
    const r = await db.prepare("INSERT OR IGNORE INTO photo_codes (code, owner_id) VALUES (?1, ?2)").bind(code, ownerId).run();
    if ((r.meta.changes ?? 0) > 0) return { ok: true, value: code };
  }
  return { ok: false, status: 503, code: "CODE_BUSY", message: "出了點問題，再試一次" };
}

/** 上傳時用掉這組碼：發給這個人、還沒被用過才成功（一句條件式 UPDATE，同一組碼同時送兩次只有一次成功） */
export async function claimVerifyCode(ownerId: string, code: string, photoId: string) {
  const r = await env
    .DB!.prepare("UPDATE photo_codes SET photo_id = ?3 WHERE code = ?1 AND owner_id = ?2 AND photo_id IS NULL")
    .bind(code, ownerId, photoId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** 查證頁限流：true＝還可以查 */
export const verifyAllowed = (ip: string | null) => hit(`verify:${ip ?? "local"}`, VERIFY_HOURLY, 3600);

export type VerifyRow = {
  photoId: string;
  thumbKey: string;
  photoDeleted: boolean;
  shareNo: number | null;
  createdAt: string | null;
  shareGone: boolean;
  handle: string | null;
  name: string | null;
  userStatus: string | null;
};

/** 查碼：照片、收藏、發文者一次撈（碼不存在回 null） */
export async function lookupVerifyCode(code: string): Promise<VerifyRow | null> {
  const r = await env
    .DB!.prepare(
      `SELECT p.id AS photoId, p.thumb_key AS thumbKey, p.deleted_at AS pDel, p.share_no AS shareNo,
              s.created_at AS createdAt, s.deleted_at AS sDel, s.hidden_at AS sHid,
              u.handle AS handle, u.name AS name, u.status AS userStatus
         FROM photos p
         LEFT JOIN shares s ON s.no = p.share_no
         LEFT JOIN users u ON u.id = p.owner_id
        WHERE p.verify_code = ?1 AND p.purpose = 'share'`,
    )
    .bind(code)
    .first<{
      photoId: string; thumbKey: string; pDel: string | null; shareNo: number | null; createdAt: string | null;
      sDel: string | null; sHid: string | null; handle: string | null; name: string | null; userStatus: string | null;
    }>();
  if (!r) return null;
  return {
    photoId: r.photoId,
    thumbKey: r.thumbKey,
    photoDeleted: Boolean(r.pDel),
    shareNo: r.shareNo,
    createdAt: r.createdAt,
    shareGone: r.shareNo === null || !r.createdAt || Boolean(r.sDel) || Boolean(r.sHid),
    handle: r.handle,
    name: r.name,
    userStatus: r.userStatus,
  };
}
