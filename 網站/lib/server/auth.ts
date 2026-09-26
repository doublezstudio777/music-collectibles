// 帳號與 session。網頁用 HttpOnly cookie，App 用 Authorization: Bearer，兩者是同一張 sessions 表、同一種 token。

import { env } from "cloudflare:workers";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { emailCodes, sessions, users } from "@/db/schema";
import { randomToken, sha256hex, sixDigitCode } from "@/lib/server/crypto";
import { codeMail, getMailer } from "@/lib/server/services";

export const SESSION_COOKIE = "yz_session";
const SESSION_DAYS = 30;
const CODE_MINUTES = 15;
const CODE_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 60;

export type User = typeof users.$inferSelect;

/** 管理員：Email 在環境變數 ADMIN_EMAILS（逗號分隔）裡、且 Email 已驗證。沒有 API 能改這份名單 */
export function isAdmin(u: Pick<User, "email" | "emailVerifiedAt"> | null | undefined) {
  if (!u?.emailVerifiedAt) return false;
  const list = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(u.email.toLowerCase());
}

/** API 回給前端的使用者（不含雜湊與 email 以外的敏感欄位） */
export const publicMe = (u: User) => ({
  id: u.id,
  email: u.email,
  handle: u.handle,
  name: u.name,
  bio: u.bio,
  role: u.role,
  verified: Boolean(u.emailVerifiedAt),
  admin: isAdmin(u),
  deletionRequested: Boolean(u.deletionRequestedAt),
});
export type Me = ReturnType<typeof publicMe>;

/* ---------- 回應 ---------- */

export const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers });

/** 錯誤一律 { error: { code, message } }，code 給 App 判斷、message 直接顯示 */
export const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  json({ error: { code, message, ...extra } }, status);

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const data = await req.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip");

/* ---------- 驗證規則 ---------- */

export const normEmail = (v: unknown) => str(v).toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const validPassword = (p: string) => p.length >= 8 && p.length <= 200;
const RESERVED = new Set([
  "admin", "api", "me", "login", "signup", "logout", "settings", "share", "u", "artist", "tag",
  "search", "messages", "help", "support", "system", "root", "yinzang", "official", "null", "undefined",
]);
export function handleProblem(h: string) {
  if (!/^[a-z0-9_-]{3,20}$/.test(h)) return "帳號名 3～20 字，只能用小寫英文、數字、底線、連字號";
  if (RESERVED.has(h)) return "這個帳號名保留給網站用，換一個";
  return null;
}

/* ---------- session ---------- */

function cookieFlags(req: Request) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export const sessionCookie = (req: Request, token: string) =>
  `${SESSION_COOKIE}=${token}; ${cookieFlags(req)}; Max-Age=${SESSION_DAYS * 86400}`;
export const clearCookie = (req: Request) => `${SESSION_COOKIE}=; ${cookieFlags(req)}; Max-Age=0`;

export async function createSession(userId: string, req: Request, client: "web" | "app") {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await getDb()
    .insert(sessions)
    .values({
      id: await sha256hex(token),
      userId,
      client,
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      expiresAt,
    });
  return token;
}

/**
 * 登入成功的回應：網頁拿 cookie（token 不進 JS），App（client: "app"）拿 body 裡的 token。
 */
export async function loginResponse(user: User, req: Request, client: "web" | "app", status = 200) {
  const token = await createSession(user.id, req, client);
  if (client === "app") return json({ user: publicMe(user), token }, status);
  return json({ user: publicMe(user) }, status, { "Set-Cookie": sessionCookie(req, token) });
}

export function tokenFrom(req: Request): { token: string; via: "bearer" | "cookie" } | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return { token: auth.slice(7).trim(), via: "bearer" };
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? { token: m[1], via: "cookie" } : null;
}

export async function userByToken(token: string): Promise<{ user: User; sessionId: string } | null> {
  if (!token) return null;
  const db = getDb();
  const id = await sha256hex(token);
  const now = new Date();
  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now.toISOString())));
  if (!row || row.user.status !== "active") return null;
  // 滑動期限：超過一天沒更新才寫一次，省 D1 寫入額度
  if (now.getTime() - Date.parse(row.session.lastSeenAt) > 86400_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString() })
      .where(eq(sessions.id, id));
  }
  return { user: row.user, sessionId: id };
}

export async function currentUser(req: Request) {
  const t = tokenFrom(req);
  return t ? userByToken(t.token) : null;
}

/**
 * 需要登入的寫入端點用這個。cookie 驗證的非 GET 請求再擋一次跨站（Origin 必須同站），
 * Bearer 不受 CSRF 影響不用擋。
 */
export async function requireUser(req: Request): Promise<{ user: User; sessionId: string } | Response> {
  const t = tokenFrom(req);
  if (!t) return fail(401, "UNAUTHENTICATED", "請先登入");
  if (t.via === "cookie" && req.method !== "GET" && !sameOrigin(req)) {
    return fail(403, "BAD_ORIGIN", "請從音藏網站操作");
  }
  const s = await userByToken(t.token);
  if (!s) return fail(401, "UNAUTHENTICATED", "登入已過期，請重新登入");
  return s;
}

export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function destroySession(sessionId: string) {
  await getDb().delete(sessions).where(eq(sessions.id, sessionId));
}

export async function destroyAllSessions(userId: string) {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

/* ---------- 6 位數碼 ---------- */

const codeHash = (userId: string, purpose: string, code: string) => sha256hex(`${userId}:${purpose}:${code}`);

/** 寄新碼；60 秒內重寄會被擋（回傳剩幾秒） */
export async function sendCode(user: User, purpose: "verify" | "reset"): Promise<{ ok: true } | { ok: false; wait: number }> {
  const db = getDb();
  const [last] = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.userId, user.id), eq(emailCodes.purpose, purpose)))
    .orderBy(desc(emailCodes.id))
    .limit(1);
  if (last) {
    const since = (Date.now() - Date.parse(last.createdAt)) / 1000;
    if (since < RESEND_COOLDOWN_SEC) return { ok: false, wait: Math.ceil(RESEND_COOLDOWN_SEC - since) };
  }
  // 舊碼作廢，一次只有一組有效
  await db
    .update(emailCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(emailCodes.userId, user.id), eq(emailCodes.purpose, purpose), isNull(emailCodes.usedAt)));
  const code = sixDigitCode();
  await db.insert(emailCodes).values({
    userId: user.id,
    purpose,
    codeHash: await codeHash(user.id, purpose, code),
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  });
  await getMailer().send(codeMail(user.email, purpose, code));
  return { ok: true };
}

/** 核對碼：錯 5 次整組作廢 */
export async function checkCode(user: User, purpose: "verify" | "reset", code: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.userId, user.id), eq(emailCodes.purpose, purpose), isNull(emailCodes.usedAt)))
    .orderBy(desc(emailCodes.id))
    .limit(1);
  if (!row || Date.parse(row.expiresAt) <= Date.now() || row.attempts >= CODE_MAX_ATTEMPTS) return "expired" as const;
  if ((await codeHash(user.id, purpose, code)) !== row.codeHash) {
    await db.update(emailCodes).set({ attempts: row.attempts + 1 }).where(eq(emailCodes.id, row.id));
    return "wrong" as const;
  }
  await db.update(emailCodes).set({ usedAt: new Date().toISOString() }).where(eq(emailCodes.id, row.id));
  return "ok" as const;
}

export async function userByEmail(email: string) {
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  return u ?? null;
}

export async function userByHandle(handle: string) {
  const [u] = await getDb().select().from(users).where(eq(users.handle, handle));
  return u ?? null;
}

/** 管理後台 API 用：沒登入 401、不是管理員 403 */
export async function requireAdmin(req: Request): Promise<{ user: User; sessionId: string } | Response> {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  if (!isAdmin(s.user)) return fail(403, "FORBIDDEN", "只有管理員可以用");
  return s;
}
