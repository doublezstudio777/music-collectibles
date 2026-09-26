// 音藏 D1 資料表（drizzle）。
//
// 硬約束：資料永久保存。改結構只能新增遷移（npm run db:generate 產生 drizzle/00xx_*.sql），
// 只做「加表、加欄位、加索引」這類不重建表的變更；禁止 drop／rename 既有表與欄位，
// 也不要改既有欄位的型別或約束（SQLite 會整張重建）。設計見 產出/20260927_第2階段技術設計.md。
//
// 2a 只有帳號與個人狀態。內容表（藝人、系列、品項、版本、炫收藏、照片）2b 才進來；
// 點讚、我有、想要、追蹤用內容的公開識別碼（炫收藏流水號、藝人 slug、版本鍵）記錄，
// 刻意不設外鍵：之後加內容表不必重建這幾張表，內容也一律軟刪除，不會留下孤兒。

import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const users = sqliteTable(
  "users",
  {
    /** 隨機 id（不外露順序），其他表都用這個關聯 */
    id: text("id").primaryKey(),
    /** 一律存小寫 */
    email: text("email").notNull(),
    /** 有值＝已驗證 Email＝認證帳號（檢舉權限看這個） */
    emailVerifiedAt: text("email_verified_at"),
    /** `pbkdf2-sha256${iterations}${salt b64}${hash b64}`，演算法與次數跟著存，之後可升級 */
    passwordHash: text("password_hash").notNull(),
    /** 個人頁網址 /u/{handle}，小寫英數、底線、連字號 */
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    bio: text("bio").notNull().default(""),
    /** user｜admin（管理後台 2b 接） */
    role: text("role").notNull().default("user"),
    /** active｜suspended */
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), uniqueIndex("users_handle_uq").on(t.handle)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** token 的 SHA-256（hex）；token 本身只在 cookie 或 App 手上 */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** web｜app */
    client: text("client").notNull().default("web"),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: text("created_at").notNull().default(now),
    lastSeenAt: text("last_seen_at").notNull().default(now),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** 驗證信箱、重設密碼的 6 位數碼（只存雜湊） */
export const emailCodes = sqliteTable(
  "email_codes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** verify｜reset */
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [index("email_codes_user_idx").on(t.userId, t.purpose)],
);

/** 簡單的固定視窗計數：登入失敗、寄信頻率 */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: text("reset_at").notNull(),
});

/** 點讚＝喜愛清單。share_no＝炫收藏流水號（/share/{n}） */
export const likes = sqliteTable(
  "likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareNo: integer("share_no").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.shareNo] }), index("likes_share_idx").on(t.shareNo)],
);

/** 我有／想要，公開。target_key＝版本鍵 `{藝人}/{系列流水號}#{品項}-{版本}` */
export const holdings = sqliteTable(
  "holdings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** owned｜wanted */
    kind: text("kind").notNull(),
    targetKey: text("target_key").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.targetKey] }), index("holdings_target_idx").on(t.targetKey, t.kind)],
);

/** 追蹤藝人（本人才看得到） */
export const follows = sqliteTable(
  "follows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    artistSlug: text("artist_slug").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.artistSlug] }), index("follows_artist_idx").on(t.artistSlug)],
);
