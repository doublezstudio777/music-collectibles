// 外部服務的接縫：寄信、Turnstile、頻率限制。
// 寄信本輪只有 console 版；下輪接真的服務時只加一個 Mailer 實作，呼叫端不動。

import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";

/* ---------- 寄信 ---------- */

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** 本機：印在跑 dev server 的終端機。驗收腳本從這一行抓驗證碼 */
const consoleMailer: Mailer = {
  async send(mail) {
    console.log(`[音藏寄信] to=${mail.to} subject=${mail.subject}\n${mail.text}\n[音藏寄信結束]`);
  },
};

export function getMailer(): Mailer {
  const mode = env.MAIL_MODE ?? "console";
  if (mode === "console") return consoleMailer;
  // 正式寄信服務（Resend／Brevo…）在 2b 或 2c 接；沒設定前寧可失敗也不要默默吞信
  throw new Error(`寄信服務 ${mode} 還沒接上`);
}

export const codeMail = (to: string, purpose: "verify" | "reset", code: string): Mail =>
  purpose === "verify"
    ? {
        to,
        subject: `音藏驗證碼 ${code}`,
        text: `你的音藏驗證碼是 ${code}\n15 分鐘內有效。不是你註冊的話，不用理會這封信。`,
      }
    : {
        to,
        subject: `音藏重設密碼驗證碼 ${code}`,
        text: `重設密碼的驗證碼是 ${code}\n15 分鐘內有效。不是你要重設的話，不用理會這封信，密碼不會變。`,
      };

/* ---------- Turnstile ---------- */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token: unknown, ip: string | null) {
  if (typeof token !== "string" || !token) return false;
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export const turnstileSiteKey = () => env.TURNSTILE_SITE_KEY ?? "";

/* ---------- 頻率限制（固定視窗） ---------- */

/** 回傳 true＝還在額度內（並記一次）；false＝超過 */
export async function hit(key: string, limit: number, windowSec: number) {
  const db = getDb();
  const nowMs = Date.now();
  const resetAt = new Date(nowMs + windowSec * 1000).toISOString();
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  if (!row || Date.parse(row.resetAt) <= nowMs) {
    await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: 1, resetAt } });
    return true;
  }
  if (row.count >= limit) return false;
  await db.update(rateLimits).set({ count: sql`${rateLimits.count} + 1` }).where(eq(rateLimits.key, key));
  return true;
}

export async function clearHits(key: string) {
  await getDb().delete(rateLimits).where(eq(rateLimits.key, key));
}
