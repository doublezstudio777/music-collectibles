// 意見回饋（2026-09-29）：/feedback 送出、後台「意見回饋」佇列。
// 附件照片（選填 1 張）瀏覽器端先壓成 WebP／JPEG（主圖＋縮圖），存 R2 的 f/，只給管理員看（/api/admin/feedback/photo），不走 /img/。
import { env } from "cloudflare:workers";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, feedback } from "@/db/schema";
import { FEEDBACK_MAX, FEEDBACK_PER_HOUR, isFeedbackKind, type FeedbackKind } from "@/lib/feedback";
import { normEmail, validEmail, type User } from "@/lib/server/auth";
import { userNames } from "@/lib/server/content";
import { MAX_MAIN_BYTES, MAX_THUMB_BYTES, releaseBytes, reserveBytes, sniff } from "@/lib/server/photos";
import { hit } from "@/lib/server/services";
import { randomToken } from "@/lib/server/crypto";
import { HttpError } from "@/lib/server/trade";

const nowIso = () => new Date().toISOString();

export async function submitFeedback(
  viewer: User | null,
  ip: string | null,
  input: { kind: unknown; body: unknown; email: unknown; image: File | null; thumb: File | null },
) {
  if (!isFeedbackKind(input.kind)) throw new HttpError(400, "INVALID", "選一個類型");
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new HttpError(400, "INVALID", "寫一下內容");
  if (Array.from(body).length > FEEDBACK_MAX) throw new HttpError(400, "INVALID", `內容最多 ${FEEDBACK_MAX} 字`);
  let email = normEmail(input.email);
  if (!email && viewer) email = viewer.email;
  if (!email) throw new HttpError(400, "INVALID_EMAIL", "填回覆用的 Email");
  if (!validEmail(email)) throw new HttpError(400, "INVALID_EMAIL", "Email 格式不對");
  let main: Uint8Array | null = null;
  let thumb: Uint8Array | null = null;
  if (input.image && input.image.size > 0) {
    if (!input.thumb || input.image.size > MAX_MAIN_BYTES || input.thumb.size > MAX_THUMB_BYTES) throw new HttpError(413, "TOO_LARGE", "照片太大，換一張再試");
    main = new Uint8Array(await input.image.arrayBuffer());
    thumb = new Uint8Array(await input.thumb.arrayBuffer());
    if (!sniff(main) || !sniff(thumb)) throw new HttpError(415, "BAD_FORMAT", "只收 WebP 或 JPEG 照片");
  }
  if (!(await hit(`feedback:${ip ?? "local"}`, FEEDBACK_PER_HOUR, 3600))) throw new HttpError(429, "RATE_LIMITED", "送出太多次了，一小時後再試");

  let photoKey: string | null = null;
  let thumbKey: string | null = null;
  let bytes = 0;
  if (main && thumb) {
    const bucket = env.PHOTOS;
    bytes = main.length + thumb.length;
    if (!bucket || !(await reserveBytes(bytes))) throw new HttpError(503, "UPLOAD_PAUSED", "照片暫時收不了，可以先不附照片");
    const id = randomToken(12);
    const ext = (b: Uint8Array) => (sniff(b) === "image/webp" ? "webp" : "jpg");
    photoKey = `f/${id}.${ext(main)}`;
    thumbKey = `f/${id}_t.${ext(thumb)}`;
    try {
      await bucket.put(photoKey, main, { httpMetadata: { contentType: sniff(main)! } });
      await bucket.put(thumbKey, thumb, { httpMetadata: { contentType: sniff(thumb)! } });
    } catch {
      await releaseBytes(bytes);
      throw new HttpError(502, "STORAGE_ERROR", "照片存不進去，再試一次");
    }
  }
  const [row] = await getDb()
    .insert(feedback)
    .values({ kind: input.kind as FeedbackKind, body, email, userId: viewer?.id ?? null, photoKey, thumbKey, photoBytes: bytes })
    .returning({ id: feedback.id });
  return { id: row.id };
}

export type AdminFeedback = {
  id: number;
  kind: FeedbackKind;
  body: string;
  email: string;
  by: { handle: string; name: string } | null;
  photo: boolean;
  status: "open" | "done";
  note: string;
  handledBy: string;
  handledAt: string | null;
  createdAt: string;
};

export async function adminFeedback(): Promise<AdminFeedback[]> {
  const db = getDb();
  const [open, done] = await db.batch([
    db.select().from(feedback).where(eq(feedback.status, "open")).orderBy(desc(feedback.id)),
    db.select().from(feedback).where(eq(feedback.status, "done")).orderBy(desc(feedback.handledAt)).limit(50),
  ]);
  const rows = [...open, ...done];
  const names = await userNames([...rows.map((r) => r.userId ?? ""), ...rows.map((r) => r.handledBy ?? "")].filter(Boolean));
  return rows.map((r) => {
    const who = r.userId ? names.get(r.userId) : undefined;
    return {
      id: r.id,
      kind: r.kind as FeedbackKind,
      body: r.body,
      email: r.email,
      by: who ? { handle: who.handle, name: who.name } : null,
      photo: Boolean(r.photoKey),
      status: r.status === "done" ? "done" : "open",
      note: r.note,
      handledBy: r.handledBy ? (names.get(r.handledBy)?.name ?? "") : "",
      handledAt: r.handledAt,
      createdAt: r.createdAt,
    };
  });
}

/** 管理員：action＝done（已處理）｜reopen（改回未處理）｜note（只存內部備註） */
export async function handleFeedback(admin: User, id: number, action: unknown, rawNote: unknown) {
  if (action !== "done" && action !== "reopen" && action !== "note") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 2000) : undefined;
  const set =
    action === "done"
      ? { status: "done", handledBy: admin.id, handledAt: nowIso(), ...(note !== undefined ? { note } : {}) }
      : action === "reopen"
        ? { status: "open", handledBy: null, handledAt: null }
        : { note: note ?? "" };
  const r = await getDb().update(feedback).set(set).where(eq(feedback.id, id)).returning({ id: feedback.id });
  if (!r.length) throw new HttpError(404, "NOT_FOUND", "找不到這筆意見回饋");
  const action_ = action === "done" ? "意見回饋：已處理" : action === "reopen" ? "意見回饋：改回未處理" : "意見回饋：備註";
  await getDb().insert(adminLog).values({ adminId: admin.id, action: action_, target: `feedback:${id}`, detail: "{}" });
}

export async function openFeedbackCount() {
  const [r] = await getDb().select({ n: sql<number>`COUNT(*)` }).from(feedback).where(eq(feedback.status, "open"));
  return r?.n ?? 0;
}

/** 附件照片（只給管理員）：size＝thumb｜full */
export async function feedbackPhoto(id: number, size: string) {
  const [r] = await getDb().select({ p: feedback.photoKey, t: feedback.thumbKey }).from(feedback).where(eq(feedback.id, id));
  const key = size === "thumb" ? r?.t : r?.p;
  if (!key || !env.PHOTOS) return null;
  return env.PHOTOS.get(key);
}
