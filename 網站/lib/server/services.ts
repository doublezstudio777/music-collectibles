// 外部服務的接縫：寄信、Turnstile、頻率限制。
// 寄信本輪只有 console 版；下輪接真的服務時只加一個 Mailer 實作，呼叫端不動。

import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";

/* ---------- 寄信 ---------- */
// 2c：環境變數有 RESEND_API_KEY 就走 Resend，沒有就印在 console（本機開發、驗收都走 console）。
// MAIL_ALLOWLIST（逗號分隔）有設時，只寄給名單裡的收件人，其他照樣印 console：本機做真實寄信測試用，正式環境不設。

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

const RESEND_URL = "https://api.resend.com/emails";
export const MAIL_FROM = "音藏 <noreply@notify.dblzm.com>";
export const MAIL_REPLY_TO = "zukawork0312@gmail.com";

function resendMailer(key: string): Mailer {
  return {
    async send(mail) {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.MAIL_FROM || MAIL_FROM,
          to: [mail.to],
          reply_to: env.MAIL_REPLY_TO || MAIL_REPLY_TO,
          subject: mail.subject,
          text: mail.text,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok) {
        // 不印信件內容（有驗證碼），只印錯誤
        console.error(`[音藏寄信] Resend 失敗 status=${res.status} ${data.name ?? ""} ${data.message ?? ""}`);
        throw new Error("寄信失敗");
      }
      console.log(`[音藏寄信] Resend 已送出 id=${data.id} to=${mail.to}`);
    },
  };
}

export function getMailer(): Mailer {
  const key = env.RESEND_API_KEY;
  if (!key) return consoleMailer;
  const allow = (env.MAIL_ALLOWLIST ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const resend = resendMailer(key);
  if (!allow.length) return resend;
  return { send: (mail) => (allow.includes(mail.to.toLowerCase()) ? resend.send(mail) : consoleMailer.send(mail)) };
}

export const mailerMode = () => (env.RESEND_API_KEY ? (env.MAIL_ALLOWLIST ? "resend（限名單）" : "resend") : "console");

/** 信件只放驗證碼與一句說明 */
export const codeMail = (to: string, purpose: "verify" | "reset", code: string): Mail =>
  purpose === "verify"
    ? { to, subject: `音藏驗證碼 ${code}`, text: `音藏驗證碼：${code}\n15 分鐘內有效，不是你本人註冊的話，不用理會這封信。` }
    : { to, subject: `音藏重設密碼驗證碼 ${code}`, text: `音藏重設密碼驗證碼：${code}\n15 分鐘內有效，不是你本人要重設的話，不用理會這封信，密碼不會變。` };

/* ---------- 密碼雜湊次數 ---------- */

/**
 * PBKDF2 次數。Workers 上限 100,000；免費方案每次請求 CPU 10ms，部署後實測超過就用環境變數
 * PBKDF2_ITERATIONS 調低（10,000～100,000），不升級付費。舊密碼在下次登入成功時自動改用新次數。
 */
export function passwordIterations() {
  const n = Number(env.PBKDF2_ITERATIONS);
  return Number.isInteger(n) && n >= 10_000 && n <= 100_000 ? n : 100_000;
}

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
