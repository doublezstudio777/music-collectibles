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
    /** 2b：使用者在設定頁申請刪除帳號的時間（實際刪除策略待使用者確認，見技術設計第十五節） */
    deletionRequestedAt: text("deletion_requested_at"),
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

/* =====================================================================
 * 第 2b 階段：內容表、交易、檢舉申訴、管理後台（drizzle/0001）
 * 全部是新表；users 只加一個可為 NULL 的欄位（deletion_requested_at）。
 * 內容一律軟刪除（deleted_at），審核狀態 status：approved｜pending｜rejected，
 * 頁面只讀 approved。JSON 欄位存字串，讀的時候 parse。
 * ===================================================================== */

/** 藝人與發行單位。slug 一經建立不改 */
export const artists = sqliteTable(
  "artists",
  {
    slug: text("slug").primaryKey(),
    name: text("name").notNull(),
    /** JSON string[]：英文名、常見寫法 */
    aliases: text("aliases").notNull().default("[]"),
    /** 藝人｜發行單位 */
    kind: text("kind").notNull().default("藝人"),
    /** male｜female｜group｜NULL（待確認） */
    gender: text("gender"),
    /** domestic｜overseas｜NULL */
    region: text("region"),
    tagline: text("tagline").notNull().default(""),
    /** JSON string[]：簡介段落（2c 起改由 revisions 管，這欄是目前版本） */
    intro: text("intro").notNull().default("[]"),
    /** JSON { year, award, category, result }[] */
    awards: text("awards").notNull().default("[]"),
    /** 維基百科簡介來源：條目網址、授權、擷取日 */
    wikiUrl: text("wiki_url"),
    wikiLicense: text("wiki_license"),
    wikiFetchedAt: text("wiki_fetched_at"),
    /** 匯入來源（例：金曲金音近三屆入圍名單） */
    source: text("source"),
    status: text("status").notNull().default("approved"),
    createdBy: text("created_by"),
    lastEditBy: text("last_edit_by"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("artists_status_idx").on(t.status)],
);

/** 系列：一次發行或一場活動，網址 /artist/{artist_slug}/{no} */
export const series = sqliteTable(
  "series",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    artistSlug: text("artist_slug").notNull(),
    /** 發行方底下的流水號，永不重用（含待審與被拒的） */
    no: integer("no").notNull(),
    title: text("title").notNull(),
    name: text("name").notNull(),
    seriesType: text("series_type").notNull().default(""),
    /** JSON string[]：共同署名 slug */
    credits: text("credits").notNull().default("[]"),
    year: text("year").notNull().default(""),
    /** JSON string[] */
    body: text("body").notNull().default("[]"),
    /** JSON { artistSlug, role, track }[] */
    guests: text("guests").notNull().default("[]"),
    /** JSON { artistSlug, track }[] */
    compilation: text("compilation").notNull().default("[]"),
    status: text("status").notNull().default("approved"),
    createdBy: text("created_by"),
    lastEditBy: text("last_edit_by"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [uniqueIndex("series_artist_no_uq").on(t.artistSlug, t.no), index("series_status_idx").on(t.status)],
);

/** 品項：系列裡的一種東西（CD、毛巾…），錨點 #{item_id} */
export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seriesId: integer("series_id").notNull(),
    itemId: text("item_id").notNull(),
    kind: text("kind").notNull(),
    sort: integer("sort").notNull().default(0),
    status: text("status").notNull().default("approved"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [uniqueIndex("items_series_item_uq").on(t.seriesId, t.itemId)],
);

/** 版本：錨點 #{item_id}-{version_id} */
export const versions = sqliteTable(
  "versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemRef: integer("item_ref").notNull(),
    versionId: text("version_id").notNull(),
    edition: text("edition").notNull(),
    year: text("year").notNull().default(""),
    region: text("region").notNull().default(""),
    label: text("label").notNull().default(""),
    catalog: text("catalog").notNull().default("待查證"),
    barcode: text("barcode").notNull().default("無條碼"),
    packaging: text("packaging").notNull().default(""),
    contents: text("contents").notNull().default(""),
    tracks: text("tracks").notNull().default(""),
    identifyBy: text("identify_by").notNull().default(""),
    /** 已確認｜待確認｜有爭議 */
    dataStatus: text("data_status").notNull().default("待確認"),
    color: text("color").notNull().default("#22334D"),
    sort: integer("sort").notNull().default(0),
    status: text("status").notNull().default("approved"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [uniqueIndex("versions_item_version_uq").on(t.itemRef, t.versionId)],
);

/** 正版辨識：版本的逐項特徵 */
export const versionMarks = sqliteTable(
  "version_marks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    versionRef: integer("version_ref").notNull(),
    label: text("label").notNull(),
    text: text("text").notNull(),
    /** 照片說明（還沒有真照片時畫灰色塊） */
    photoNote: text("photo_note"),
    photoId: text("photo_id"),
    sort: integer("sort").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("version_marks_version_idx").on(t.versionRef)],
);

/** 已知仿冒：rows＝JSON { label, genuine, fake }[] */
export const versionFakes = sqliteTable(
  "version_fakes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    versionRef: integer("version_ref").notNull(),
    name: text("name").notNull(),
    seen: text("seen").notNull().default(""),
    rows: text("rows").notNull().default("[]"),
    sort: integer("sort").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("version_fakes_version_idx").on(t.versionRef)],
);

/** 炫收藏。no＝公開流水號 /share/{no}；出售狀態直接掛在這裡 */
export const shares = sqliteTable(
  "shares",
  {
    no: integer("no").primaryKey({ autoIncrement: true }),
    authorId: text("author_id").notNull(),
    what: text("what").notNull(),
    kind: text("kind").notNull(),
    kindNote: text("kind_note"),
    story: text("story").notNull().default(""),
    /** JSON string[]：跟誰有關 */
    about: text("about").notNull().default("[]"),
    /** JSON string[] */
    tags: text("tags").notNull().default("[]"),
    seriesKey: text("series_key"),
    itemId: text("item_id"),
    versionId: text("version_id"),
    refPhoto: integer("ref_photo").notNull().default(0),
    color: text("color").notNull().default(""),
    /** share｜offer｜sale｜sold */
    saleState: text("sale_state").notNull().default("share"),
    price: integer("price"),
    soldPrice: integer("sold_price"),
    soldTo: text("sold_to"),
    soldAt: text("sold_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("shares_author_idx").on(t.authorId), index("shares_series_idx").on(t.seriesKey)],
);

/** 照片：R2 物件（主圖＋縮圖）。bytes 是兩個檔加總，D1 累計用量看 counters.r2_bytes */
export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    /** share｜appeal｜mark */
    purpose: text("purpose").notNull().default("share"),
    shareNo: integer("share_no"),
    r2Key: text("r2_key").notNull(),
    thumbKey: text("thumb_key").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    sort: integer("sort").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("photos_share_idx").on(t.shareNo), index("photos_owner_idx").on(t.ownerId, t.createdAt)],
);

/** 整數計數器：r2_bytes（R2 累計位元組） */
export const counters = sqliteTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

/** 出價與我要買。status：open｜accepted｜rejected｜withdrawn｜sold */
export const offers = sqliteTable(
  "offers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareNo: integer("share_no").notNull(),
    buyerId: text("buyer_id").notNull(),
    threadId: integer("thread_id").notNull(),
    /** offer｜buy */
    kind: text("kind").notNull(),
    price: integer("price").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("offers_share_idx").on(t.shareNo), index("offers_buyer_idx").on(t.buyerId)],
);

/** 私訊只能從一則收藏發起：一位買家對一則收藏一條 */
export const threads = sqliteTable(
  "threads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareNo: integer("share_no").notNull(),
    buyerId: text("buyer_id").notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("threads_share_buyer_uq").on(t.shareNo, t.buyerId), index("threads_buyer_idx").on(t.buyerId)],
);

/** from_id 為 NULL＝系統訊息（灰字）；offer_id 有值＝結構化出價 */
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id").notNull(),
    fromId: text("from_id"),
    text: text("text"),
    offerId: integer("offer_id"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("messages_thread_idx").on(t.threadId)],
);

/** 已讀到哪一則 */
export const threadReads = sqliteTable(
  "thread_reads",
  {
    threadId: integer("thread_id").notNull(),
    userId: text("user_id").notNull(),
    lastMessageId: integer("last_message_id").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] })],
);

/** 檢舉：target＝share:{n}｜item:{鍵}｜version:{鍵}；一人一次 */
export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    target: text("target").notNull(),
    reporterId: text("reporter_id").notNull(),
    /** fake｜never｜other */
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("reports_target_reporter_uq").on(t.target, t.reporterId), index("reports_target_idx").on(t.target)],
);

/** 申訴：status pending｜unlocked｜kept；photo_ids＝JSON string[] */
export const appeals = sqliteTable(
  "appeals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    target: text("target").notNull(),
    byId: text("by_id").notNull(),
    text: text("text").notNull(),
    photoIds: text("photo_ids").notNull().default("[]"),
    status: text("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("appeals_target_idx").on(t.target), index("appeals_status_idx").on(t.status)],
);

/** 管理者對某個對象的裁決：unlocked 優先於門檻，kept 不看門檻 */
export const targetDecisions = sqliteTable("target_decisions", {
  target: text("target").primaryKey(),
  decision: text("decision").notNull(),
  decidedBy: text("decided_by").notNull(),
  decidedAt: text("decided_at").notNull().default(now),
});

/** 系統設定：report_threshold、paused… */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

/** 管理後台操作紀錄 */
export const adminLog = sqliteTable(
  "admin_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adminId: text("admin_id").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull().default(""),
    /** JSON */
    detail: text("detail").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("admin_log_created_idx").on(t.createdAt)],
);
