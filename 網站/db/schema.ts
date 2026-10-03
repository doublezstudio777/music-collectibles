// 樂迷藏 D1 資料表（drizzle）。
//
// 硬約束：資料永久保存。改結構只能新增遷移（npm run db:generate 產生 drizzle/00xx_*.sql），
// 只做「加表、加欄位、加索引」這類不重建表的變更；禁止 drop／rename 既有表與欄位，
// 也不要改既有欄位的型別或約束（SQLite 會整張重建）。設計見 產出/20260927_第2階段技術設計.md。
//
// 2a 只有帳號與個人狀態。內容表（藝人、系列、品項、版本、炫收藏、照片）2b 才進來；
// 點讚、我有、想要、追蹤用內容的公開識別碼（炫收藏流水號、藝人 slug、版本鍵）記錄，
// 刻意不設外鍵：之後加內容表不必重建這幾張表，內容也一律軟刪除，不會留下孤兒。

import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    /**
     * 2026-09-28 帳號設定（drizzle/0011）：暱稱比對鍵（NFKC、小寫、去空白；全站唯一由程式檢查，
     * 不設唯一索引，因為上線前的舊帳號可能已經重複，不能讓遷移失敗）。已刪除的帳號是 NULL
     */
    nameKey: text("name_key"),
    /** 最近一次自己改暱稱的時間（每 30 天一次） */
    nameChangedAt: text("name_changed_at"),
    /** 大頭貼 R2 檔名（v/{id}.webp，256×256）；沒有是 NULL */
    avatarKey: text("avatar_key"),
    /** 管理員執行刪除帳號的時間（status=deleted） */
    deletedAt: text("deleted_at"),
    /**
     * 2026-09-30 我的頁面（drizzle/0024）：社群連結 JSON { ig?, threads?, youtube?, facebook? }，
     * 每個值是完整 https 網址，網域白名單在 lib/profile-rules.ts，伺服器存之前驗過
     */
    links: text("links").notNull().default("{}"),
    /** 最喜歡的藝人 JSON string[]（藝人 slug，最多 5 位，照使用者排的順序） */
    favArtists: text("fav_artists").notNull().default("[]"),
    /**
     * 2026-10-01 法務修正（drizzle/0027）：最近一次同意的使用條款／隱私權政策版本與時間。
     * 跟 lib/legal.ts 的 TERMS_VERSION 不同＝還沒同意現行版本，不能發布、出價、投稿（瀏覽不擋）。每次同意另記一列 terms_consents
     */
    termsVersion: text("terms_version"),
    termsAcceptedAt: text("terms_accepted_at"),
    /** 經確認侵害他人著作權的次數（權利侵害通知成立時加 1，第 3 次停權；使用條款第 11 條） */
    copyrightStrikes: integer("copyright_strikes").notNull().default(0),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    uniqueIndex("users_handle_uq").on(t.handle),
    index("users_name_key_idx").on(t.nameKey),
  ],
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
    /** 2c：管理員隱藏（前台看不到、可恢復） */
    hiddenAt: text("hidden_at"),
    /** 2c：藝人頁顯示。auto＝有系列或收藏才顯示；on＝強制顯示；off＝強制不顯示 */
    display: text("display").notNull().default("auto"),
    /** MusicBrainz 藝人 MBID（2026-09-28 匯入時對應成功才有） */
    mbid: text("mbid"),
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
    /** 系列類型（2026-09-28 周邊選擇流程）：album｜ep｜single｜tour｜brand｜misc。misc＝每位藝人一個「周邊與其他」，第一次用到才建 */
    kind: text("kind").notNull().default("album"),
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
    hiddenAt: text("hidden_at"),
    /** MusicBrainz release-group MBID（匯入建立或去重合併時寫入） */
    mbid: text("mbid"),
    /** 資料來源：musicbrainz＝MusicBrainz 匯入建立；NULL＝站內建立或研究匯入 */
    source: text("source"),
  },
  (t) => [
    uniqueIndex("series_artist_no_uq").on(t.artistSlug, t.no),
    index("series_mbid_idx").on(t.mbid),
    index("series_status_idx").on(t.status),
    // 每位藝人最多一個「周邊與其他」（懶建立時兩個請求同時進來也不會建出兩個）
    uniqueIndex("series_misc_uq").on(t.artistSlug).where(sql`kind = 'misc'`),
  ],
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
    hiddenAt: text("hidden_at"),
    /** musicbrainz＝MusicBrainz 匯入建立 */
    source: text("source"),
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
    hiddenAt: text("hidden_at"),
    /** MusicBrainz release MBID（匯入建立或去重合併時寫入） */
    mbid: text("mbid"),
    /** musicbrainz＝MusicBrainz 匯入建立 */
    source: text("source"),
    /** 發行日期（YYYY、YYYY-MM 或 YYYY-MM-DD） */
    releaseDate: text("release_date").notNull().default(""),
    /**
     * 曲目（2026-09-28）：JSON string[]，一行一首「序. 歌名 (m:ss)」，多碟用「【第 2 碟 CD】」分段（lib/tracks.ts 解析）。
     * 之後的修改走維基式編輯（revisions target＝tracks:{系列}#{品項}-{版本}），這欄是目前版本
     */
    trackList: text("track_list").notNull().default("[]"),
  },
  (t) => [uniqueIndex("versions_item_version_uq").on(t.itemRef, t.versionId), index("versions_mbid_idx").on(t.mbid)],
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
    /** 舊欄位：2026-09-28 前會員自己勾「照片可當辨識參考」。改由管理員在照片上標（photos.ref_at），這欄不再讀也不再寫，資料保留 */
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
    hiddenAt: text("hidden_at"),
    /** 發文者最後一次編輯內容或照片（2026-09-28）；單則頁「最後編輯於」 */
    editedAt: text("edited_at"),
    /** 會員新增的系列還在審核：這則先掛「不確定」，核准後自動改掛過去（series.id）；退回就清掉 */
    pendingSeriesId: integer("pending_series_id"),
    /** 發文者自己改的標題（2026-09-28 上傳表單改版）；NULL＝用自動組的 what。系統重組標題只動 what，不動這欄 */
    customWhat: text("custom_what"),
    /**
     * 2026-10-01 一次發多張（drizzle/0028）：single＝一般收藏；collection＝全家福合集（一張或幾張大合照＋標記裡面有哪些專輯，
     * 純展示，不能出價、不能定價，標記在 collection_tags）。合集也是一則 shares，照片、查證碼、檢舉、留言、讚、刪帳重燒全部共用
     */
    postType: text("post_type").notNull().default("single"),
  },
  (t) => [
    index("shares_author_idx").on(t.authorId),
    index("shares_series_idx").on(t.seriesKey),
    index("shares_pending_series_idx").on(t.pendingSeriesId),
  ],
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
    /** 分享預覽圖（1200×630 JPEG，浮水印已燒進去）；og:image 用，沒有就退回縮圖。舊資料沒有 */
    ogKey: text("og_key"),
    /** 沒燒浮水印的原圖（2026-09-29）：R2 的 o/，/img/ 不開放這個目錄，只給改站名時重燒用。刪照片時一起刪 */
    origKey: text("orig_key"),
    /** 查證碼（2026-09-29）：5 碼大寫英數（不用 0 O 1 I L），燒進浮水印，/verify 用這組碼查回收藏。全站唯一；舊照片由重燒腳本補發 */
    verifyCode: text("verify_code"),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    sort: integer("sort").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
    /** 管理員標為「辨識參考」的時間與管理員 id（2026-09-28）；取消就清成 NULL，操作紀錄在 admin_log */
    refAt: text("ref_at"),
    refBy: text("ref_by"),
  },
  (t) => [
    index("photos_share_idx").on(t.shareNo),
    index("photos_owner_idx").on(t.ownerId, t.createdAt),
    // 2c：/img/ 依檔名查是誰的、什麼用途（申訴證據只給本人與管理員）
    index("photos_r2key_idx").on(t.r2Key),
    index("photos_thumbkey_idx").on(t.thumbKey),
    uniqueIndex("photos_verify_code_uq").on(t.verifyCode),
  ],
);

/**
 * 查證碼發號紀錄（2026-09-29）：瀏覽器燒浮水印前先跟伺服器拿碼（/api/uploads/code），上傳時帶回來，
 * 伺服器確認是發給這個人、還沒用過，才掛到 photos.verify_code。發出去的碼不會再發第二次（code 是主鍵）。
 * photo_id：用掉這組碼的照片；NULL＝發了還沒用（上傳失敗、中途取消）
 */
export const photoCodes = sqliteTable("photo_codes", {
  code: text("code").primaryKey(),
  ownerId: text("owner_id").notNull(),
  photoId: text("photo_id"),
  createdAt: text("created_at").notNull().default(now),
});

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

/**
 * 私訊對話。兩種：
 * - 收藏相關（share_no > 0）：一位買家（發起人）對一則收藏一條，另一方是那則的作者
 * - 直接私訊（2026-10-01，drizzle/0025_dm；share_no＝0）：從個人頁「傳訊息」發起，不綁收藏。
 *   buyer_id＝發起人、peer_id＝對方；pair_key＝兩人 id 排序後用 | 接起來，一對人只有一條
 * started_at：第一則訊息的時間（每日開新對話上限用，發起人＝buyer_id）
 */
export const threads = sqliteTable(
  "threads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareNo: integer("share_no").notNull(),
    buyerId: text("buyer_id").notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    peerId: text("peer_id"),
    pairKey: text("pair_key"),
    startedAt: text("started_at"),
  },
  (t) => [
    uniqueIndex("threads_share_buyer_uq").on(t.shareNo, t.buyerId).where(sql`share_no > 0`),
    uniqueIndex("threads_pair_uq").on(t.pairKey).where(sql`pair_key IS NOT NULL`),
    index("threads_buyer_idx").on(t.buyerId),
    index("threads_peer_idx").on(t.peerId),
    index("threads_started_idx").on(t.buyerId, t.startedAt),
  ],
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
    /** fake｜scam｜improper｜never｜other（share 的 other 是 2026-09-28 前的舊資料，之後改進 error_reports） */
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    /** 比對照片（選填，最多 1 張；存法同申訴證據，只有本人與管理員看得到） */
    photoId: text("photo_id"),
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

/* =====================================================================
 * 第 2c 階段（drizzle/0002）：維基式編輯、頁面鎖定、成交紀錄、不感興趣。
 * 全部是新表；既有表只加可為 NULL（或有常數預設值）的欄位與索引。
 * ===================================================================== */

/**
 * 維基式編輯紀錄。target＝artist:{slug}｜series:{slug}/{no}；field＝intro｜body。
 * 每筆存整份內容（JSON string[]，一段一個），不存差異；差異在歷史頁即時算。
 * 還原＝新增一筆內容等於舊版的紀錄（reverted_from 指向舊版），不刪任何一筆。
 */
export const revisions = sqliteTable(
  "revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    target: text("target").notNull(),
    field: text("field").notNull(),
    content: text("content").notNull(),
    /** 修改說明（必填） */
    summary: text("summary").notNull(),
    /** NULL＝匯入時的初始版本（沒有作者） */
    authorId: text("author_id"),
    revertedFrom: integer("reverted_from"),
    /** 以維基百科為底的內容：CC BY-SA 4.0 */
    license: text("license"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("revisions_target_idx").on(t.target, t.id)],
);

/** 管理員鎖定頁面（禁止編輯）。target 同 revisions */
export const pageLocks = sqliteTable("page_locks", {
  target: text("target").primaryKey(),
  lockedBy: text("locked_by").notNull(),
  lockedAt: text("locked_at").notNull().default(now),
});

/**
 * 成交紀錄（歷史價格用）。成交時寫一筆；賣家改回出售中時標 voided_at，不刪。
 * 買賣雙方只存 id，前台永遠不顯示是誰。
 */
export const deals = sqliteTable(
  "deals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareNo: integer("share_no").notNull(),
    offerId: integer("offer_id"),
    /** `{slug}/{no}#{品項}-{版本}`；沒選版本的收藏為 NULL，不進行情 */
    versionKey: text("version_key"),
    price: integer("price").notNull(),
    sellerId: text("seller_id").notNull(),
    buyerId: text("buyer_id").notNull(),
    soldAt: text("sold_at").notNull().default(now),
    voidedAt: text("voided_at"),
  },
  (t) => [index("deals_version_idx").on(t.versionKey, t.soldAt), index("deals_share_idx").on(t.shareNo)],
);

/** 首頁熱門藝人「不感興趣」：之後不再推薦 */
export const artistDismissals = sqliteTable(
  "artist_dismissals",
  {
    userId: text("user_id").notNull(),
    artistSlug: text("artist_slug").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.artistSlug] })],
);

/* =====================================================================
 * 上線後第一批（2026-09-28）：藝人識別碼轉址。只新增這一張表。
 * 藝人改網址識別碼時寫一筆 舊 → 新；/artist/{舊}/... 一律 301 到 /artist/{新}/...
 * 連續改名（a→b→c）時，舊的紀錄一併改指到最新的（a→c、b→c），不會轉兩次。
 * ===================================================================== */
export const artistRedirects = sqliteTable(
  "artist_redirects",
  {
    oldSlug: text("old_slug").primaryKey(),
    newSlug: text("new_slug").notNull(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("artist_redirects_new_idx").on(t.newSlug)],
);

/* =====================================================================
 * MusicBrainz 後續（2026-09-28，drizzle/0017）：系列轉址。只新增這一張表。
 * 兩個系列合併（同一作品被拆成兩個系列）後，被併掉的系列鍵寫一筆 舊 → 新；
 * /artist/{藝人}/{號}（含底下歷史頁）一律 301 到新系列。連續合併時舊紀錄一併改指到最新的，只轉一次。
 * ===================================================================== */
export const seriesRedirects = sqliteTable(
  "series_redirects",
  {
    /** `{藝人}/{號}` */
    oldKey: text("old_key").primaryKey(),
    newKey: text("new_key").notNull(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("series_redirects_new_idx").on(t.newKey)],
);

/* =====================================================================
 * 表單藝人預設（2026-09-28）：疑似重複藝人。只新增這一張表。
 * 兩個 slug 排序後用 `|` 接成 pair_key，管理員標「不是重複」才寫一筆，之後偵測到這組就跳過。
 * 合併不寫在這張表：合併完其中一個 slug 就不在 artists 裡了（會透過 artist_redirects 轉址），
 * 偵測時本來就找不到那組，不用另外記錄。
 * ===================================================================== */
export const artistDuplicateMarks = sqliteTable("artist_duplicate_marks", {
  pairKey: text("pair_key").primaryKey(),
  /** not_duplicate（目前只有這一種，稍後處理不用存檔） */
  decision: text("decision").notNull().default("not_duplicate"),
  decidedBy: text("decided_by").notNull(),
  decidedAt: text("decided_at").notNull().default(now),
});

/**
 * 公開內容版本號（2026-09-28 CPU 修正）。只有一列 id=1。
 * 公開頁面讀到的表一有寫入，資料庫觸發器就把 v 加 1（觸發器在 drizzle/0004_content_version.sql，
 * 不靠程式記得去加，連手動 SQL 也會觸發）。整頁快取與內容目錄的記憶體快取都以 v 當鍵，v 一變就全部作廢。
 */
export const contentVersion = sqliteTable("content_version", {
  id: integer("id").primaryKey(),
  v: integer("v").notNull().default(0),
});

/* =====================================================================
 * 防盜版＋管理後台（2026-09-28，drizzle/0005）：只新增表與索引，並拿掉 likes／holdings 的內容版本觸發器
 * （按讚、我有、想要不再讓整頁快取作廢，數字改由 /api/counts 小請求取得）。
 * 這兩張表都不掛內容版本觸發器：寫入不會讓公開頁面快取失效。
 * ===================================================================== */

/** 帳號的連線國家：註冊時與最近一次登入時（Cloudflare 判定的 ISO 國碼，例：TW） */
export const userGeo = sqliteTable("user_geo", {
  userId: text("user_id").primaryKey(),
  registerCountry: text("register_country"),
  lastLoginCountry: text("last_login_country"),
  lastLoginAt: text("last_login_at"),
});

/**
 * 每日活動：登入者一天在某個國家出現過就一列（同一天同一國只寫一次，isolate 記憶體先擋重複）。
 * 用途：所在地區（最近 30 天出現天數最多的國家）、儀表板 7／30 天活躍人數。
 */
export const userActivity = sqliteTable(
  "user_activity",
  {
    userId: text("user_id").notNull(),
    /** UTC 日期 YYYY-MM-DD */
    day: text("day").notNull(),
    country: text("country").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.country] }), index("user_activity_day_idx").on(t.day)],
);

/* =====================================================================
 * 單則炫收藏的留言（2026-09-28，drizzle/0007）：只新增兩張表與索引。
 * 兩張表都不掛內容版本觸發器：留言、刪留言、檢舉留言都不會讓公開頁面的整頁快取失效，
 * 留言由前端另外打 /api/comments 小請求載入（跟 /api/counts 讚數同一種做法）。
 * ===================================================================== */

/** 留言：純文字 500 字以內。hidden_at＝被檢舉達門檻自動隱藏；decision＝kept 表示管理員看過決定保留，不再自動隱藏 */
export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareNo: integer("share_no").notNull(),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
    deletedBy: text("deleted_by"),
    hiddenAt: text("hidden_at"),
    decision: text("decision"),
  },
  (t) => [index("comments_share_idx").on(t.shareNo, t.id), index("comments_author_idx").on(t.authorId)],
);

/** 留言的檢舉：一人對同一則留言一次。reason：scam｜abuse｜other */
export const commentReports = sqliteTable(
  "comment_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    commentId: integer("comment_id").notNull(),
    reporterId: text("reporter_id").notNull(),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("comment_reports_uq").on(t.commentId, t.reporterId), index("comment_reports_comment_idx").on(t.commentId)],
);

/* =====================================================================
 * 等級與分數（2026-09-28，drizzle/0008）：只新增三張表與索引，全部不掛內容版本觸發器。
 * 計分寫入（編輯、補資料時記一筆；每日排程彙總）不會讓公開頁面的整頁快取失效。
 * 規則與數值見 lib/server/scores.ts 開頭，門檻見 lib/levels.ts。
 * ===================================================================== */

/**
 * 分數事件：每一筆加減分一列。source 是來源的唯一鍵（例：share:12、lg:{會員}:{收藏}、edit:{第一筆修改 id}），
 * 同一來源只會有一筆。state：pending（還沒到 available_at）｜credited（已入帳）｜void（不給分，reason 寫原因）。
 * 排程每次重算 state 與 reason（被隱藏、刪除、還原、超過上限…），不刪任何一筆。
 */
export const scoreEvents = sqliteTable(
  "score_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    points: integer("points").notNull().default(0),
    occurredAt: text("occurred_at").notNull(),
    availableAt: text("available_at").notNull(),
    state: text("state").notNull().default("pending"),
    reason: text("reason"),
    /** JSON：編輯＝{ target, base, first, last, lastAt, chars }；補資料＝{ series, field, value } */
    detail: text("detail").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("score_events_source_uq").on(t.source),
    index("score_events_user_idx").on(t.userId, t.kind),
    index("score_events_kind_idx").on(t.kind, t.occurredAt),
  ],
);

/** 彙總結果：每位會員一列。score＝已入帳總分（停權也保留，停權期間的事件不計）；pending＝還在等 7 天的分數 */
export const userScores = sqliteTable("user_scores", {
  userId: text("user_id").primaryKey(),
  score: integer("score").notNull().default(0),
  pending: integer("pending").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(now),
});

/** 自動稱號：kind＝fakebuster（打假先鋒）｜topfan（某某藝人頭號樂迷，ref＝藝人 slug） */
export const userTitles = sqliteTable(
  "user_titles",
  {
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    ref: text("ref").notNull().default(""),
    since: text("since").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.ref] }), index("user_titles_ref_idx").on(t.kind, t.ref)],
);

/* =====================================================================
 * 等級定案（2026-09-28，drizzle/0009）：停權紀錄、管理員指定等級。兩張新表，都沒有內容版本觸發器。
 * ===================================================================== */

/**
 * 停權紀錄：一次停權一列。ended_at 為 NULL＝還在停權。
 * 分數凍結用：事件發生時間落在 [started_at, ended_at) 之間的一律不計。
 * reason＝fraud 詐騙｜piracy 販售盜版｜sockpuppet 分身刷分｜spam 洗版或騷擾｜other 其他
 */
export const suspensions = sqliteTable(
  "suspensions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    byAdmin: text("by_admin").notNull().default(""),
  },
  (t) => [index("suspensions_user_idx").on(t.userId, t.startedAt)],
);

/** 管理員指定等級：level＝1～25（覆蓋計算結果，分數照常累計）。取消指定＝刪這一列（紀錄在 admin_log） */
export const levelOverrides = sqliteTable("level_overrides", {
  userId: text("user_id").primaryKey(),
  level: integer("level").notNull(),
  reason: text("reason").notNull(),
  byAdmin: text("by_admin").notNull(),
  at: text("at").notNull(),
});

/* =====================================================================
 * 法務頁與帳號設定（2026-09-28，drizzle/0011）：users 加四個可為 NULL 的欄位與一個索引，新增兩張表。
 * 兩張新表都不掛內容版本觸發器（改暱稱、大頭貼改的是 users，users 本來就有觸發器）。
 * ===================================================================== */

/** 改暱稱紀錄：只有管理員看得到（後台會員頁）。帳號刪除時一併刪掉 */
export const userNameChanges = sqliteTable(
  "user_name_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    oldName: text("old_name").notNull(),
    newName: text("new_name").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("user_name_changes_user_idx").on(t.userId, t.id)],
);

/**
 * 刪帳申請：會員在設定頁填原因送出，管理員在後台「刪帳申請」執行。status：pending｜done｜cancelled。
 * 執行後不能還原。delete_photos＝執行時有沒有勾「連同照片一起刪除」；result＝JSON，各表清掉幾列
 */
export const deletionRequests = sqliteTable(
  "deletion_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(now),
    handledAt: text("handled_at"),
    handledBy: text("handled_by"),
    deletePhotos: integer("delete_photos").notNull().default(0),
    result: text("result").notNull().default("{}"),
    /** 2026-10-01：保留的照片浮水印已從原圖重燒成匿名代號的時間（scripts/reburn-watermark.py --deletion 寫入）；沒有要重燒的照片時執行當下就填 */
    reburnedAt: text("reburned_at"),
  },
  (t) => [index("deletion_requests_status_idx").on(t.status, t.id), index("deletion_requests_user_idx").on(t.userId)],
);

/* =====================================================================
 * 藝人照片（2026-09-28，drizzle/0013）：只新增一張表。
 * 藝人頁上方一張「目前使用中」的照片（status=active，每位藝人最多一張，由部分唯一索引保證）。
 * 來源兩種：wiki＝scripts/import-artist-photos.mjs 從維基共享資源匯入（只收 CC0／CC BY／CC BY-SA／公有領域，本機縮成
 * 長邊 800px JPEG 後上傳 R2 `r/`）；member＝會員投稿（瀏覽器端壓縮，規格同收藏照片：主圖 1600＋縮圖 480），進後台佇列不公開。
 * 檔案不記在 photos 表：投稿寫入不會觸發 photos 的內容版本觸發器，整頁快取只在「使用中」那張有變動時才作廢
 * （觸發器在 0013 的 SQL 裡，帶 WHEN 條件）。容量一樣計入 counters.r2_bytes。
 * status：pending（待審）｜active（使用中）｜retired（被替換下來，檔案保留，可再設回使用中）｜
 *         rejected（退回，檔案已刪）｜removed（撤下，檔案已刪）｜deleted（刪除，檔案已刪）
 * ===================================================================== */
export const artistPhotos = sqliteTable(
  "artist_photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    artistSlug: text("artist_slug").notNull(),
    /** wiki｜member */
    source: text("source").notNull(),
    status: text("status").notNull().default("pending"),
    r2Key: text("r2_key").notNull(),
    /** 縮圖；維基匯入只有一個檔，跟 r2_key 相同 */
    thumbKey: text("thumb_key").notNull(),
    contentType: text("content_type").notNull(),
    /** 主圖＋縮圖合計位元組（同一個檔只算一次） */
    bytes: integer("bytes").notNull().default(0),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    /** 投稿的會員 id；維基匯入為 NULL */
    submitterId: text("submitter_id"),
    /** 攝影者（顯示用）：維基＝Commons 的 Artist 欄文字；投稿＝投稿時的暱稱 */
    author: text("author").notNull().default(""),
    authorUrl: text("author_url"),
    /** 授權簡稱（例：CC BY-SA 4.0、CC0、公有領域）與授權條款網址 */
    license: text("license").notNull(),
    licenseUrl: text("license_url"),
    /** 來源頁：維基＝Commons 檔案頁網址；投稿＝NULL */
    sourceUrl: text("source_url"),
    /** 維基檔名（File: 之後那段），匯入去重用 */
    sourceFile: text("source_file"),
    /** 投稿附的拍攝場合（選填） */
    occasion: text("occasion").notNull().default(""),
    occasionDate: text("occasion_date").notNull().default(""),
    /** 投稿時勾的兩項聲明（本人拍攝、同意 CC BY-SA 4.0），存當下時間 */
    agreedAt: text("agreed_at"),
    createdAt: text("created_at").notNull().default(now),
    /** 第一次被設為使用中的時間（計分用） */
    activatedAt: text("activated_at"),
    handledAt: text("handled_at"),
    handledBy: text("handled_by"),
    note: text("note").notNull().default(""),
  },
  (t) => [
    index("artist_photos_artist_idx").on(t.artistSlug, t.status),
    index("artist_photos_status_idx").on(t.status, t.id),
    index("artist_photos_submitter_idx").on(t.submitterId, t.createdAt),
    index("artist_photos_r2key_idx").on(t.r2Key),
    index("artist_photos_thumbkey_idx").on(t.thumbKey),
    uniqueIndex("artist_photos_active_uq").on(t.artistSlug).where(sql`status = 'active'`),
  ],
);

/* =====================================================================
 * 錯誤回報（2026-09-28 回報入口）：單則頁「對這則收藏有疑問嗎？」選到資料有誤、不是這位藝人、
 * 重複發文、其他。只進後台佇列，不計入鎖定門檻、不算分。一人對同一則一次。
 * reason：wrong_info｜not_artist｜duplicate｜other；status：open｜fixed｜ignored
 * ===================================================================== */
export const errorReports = sqliteTable(
  "error_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareNo: integer("share_no").notNull(),
    reporterId: text("reporter_id").notNull(),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    photoId: text("photo_id"),
    status: text("status").notNull().default("open"),
    handledBy: text("handled_by"),
    handledAt: text("handled_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("error_reports_share_reporter_uq").on(t.shareNo, t.reporterId),
    index("error_reports_status_idx").on(t.status, t.id),
  ],
);

/**
 * 會員在炫收藏表單就地新增的藝人、系列（2026-09-28 上傳表單改版：改成事後審）。
 * 新增當下就是 approved、立即可用；這張表是後台「待確認的新增」清單。confirmed_at 有值＝管理員確認過。
 * ref：藝人是 slug，系列是 series.id（字串）。管理員自己新增的也記，但直接算確認過。
 */
export const catalogAdditions = sqliteTable(
  "catalog_additions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    ref: text("ref").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(now),
    confirmedAt: text("confirmed_at"),
    confirmedBy: text("confirmed_by"),
  },
  (t) => [uniqueIndex("catalog_additions_ref_uq").on(t.type, t.ref), index("catalog_additions_by_idx").on(t.createdBy)],
);

/** 自己新增的名稱改名紀錄（新增者永遠可以改，每次改都留一筆；管理員修名也記在這裡） */
export const catalogAdditionEdits = sqliteTable(
  "catalog_addition_edits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    additionId: integer("addition_id").notNull(),
    byId: text("by_id").notNull(),
    fromName: text("from_name").notNull(),
    toName: text("to_name").notNull(),
    fromYear: text("from_year").notNull().default(""),
    toYear: text("to_year").notNull().default(""),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("catalog_addition_edits_addition_idx").on(t.additionId)],
);

/* =====================================================================
 * 新手指南批次（2026-09-29，drizzle/0018）：意見回饋、收藏榮譽榜。兩張新表，都沒有內容版本觸發器。
 * ===================================================================== */

/**
 * 意見回饋（/feedback）：未登入也能送。kind＝suggest｜data｜partner｜privacy｜takedown｜other。
 * 附件照片放 R2 的 f/（只給管理員看，走 /api/admin/feedback/photo）。status＝open｜done；note＝內部備註
 */
export const feedback = sqliteTable(
  "feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    email: text("email").notNull().default(""),
    userId: text("user_id"),
    photoKey: text("photo_key"),
    thumbKey: text("thumb_key"),
    photoBytes: integer("photo_bytes").notNull().default(0),
    status: text("status").notNull().default("open"),
    note: text("note").notNull().default(""),
    handledBy: text("handled_by"),
    handledAt: text("handled_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("feedback_status_idx").on(t.status, t.id)],
);

/**
 * 收藏榮譽榜（/ranking）：每日計分排程整張重算。board＝month（本月貢獻）｜total（總榜）｜fakebuster（打假先鋒）｜topfan（頭號樂迷，ref＝藝人 slug）。
 * points＝month 是本月入帳的分數，其他是累計分數；period＝台灣時間的月份（month 用）
 */
export const rankings = sqliteTable(
  "rankings",
  {
    board: text("board").notNull(),
    pos: integer("pos").notNull(),
    userId: text("user_id").notNull(),
    points: integer("points").notNull().default(0),
    ref: text("ref").notNull().default(""),
    period: text("period").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.board, t.pos] }), index("rankings_user_idx").on(t.userId, t.board)],
);

/**
 * 首頁推薦歌曲（2026-09-29）：首頁上方的 Spotify 嵌入播放器從這裡隨機挑一首（瀏覽器端挑）。
 * 只推薦站上藝人的歌；title 只給後台辨認，前台不顯示（歌名只出現在 Spotify 播放器裡）。
 * 任何變動都讓 content_version 加 1（遷移 0021 的觸發器），首頁整頁快取跟著換。
 */
export const spotifyPicks = sqliteTable(
  "spotify_picks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    artistSlug: text("artist_slug").notNull(),
    /** Spotify 歌曲 ID（22 碼英數） */
    trackId: text("track_id").notNull(),
    title: text("title").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    enabled: integer("enabled").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("spotify_picks_artist_track_uq").on(t.artistSlug, t.trackId), index("spotify_picks_enabled_idx").on(t.enabled, t.sort)],
);

/**
 * Spotify 自動抽歌（2026-09-30）：站上藝人 ↔ Spotify 藝人 ID，加上每天抽歌的狀態。
 * 對應由 scripts/spotify-match.mjs 寫入（MusicBrainz 連結／手動歌單／搜尋比對，不確定的不配）。
 * 排程（lib/server/spotify-draw.ts）每天替每位啟用的藝人從完整作品裡隨機抽一首，寫進 track_id 等欄位與 spotify_draws。
 * 刻意不設 content_version 觸發器：一晚抽完才由排程加 1 一次，避免整頁快取與內容目錄一晚重建幾十次。
 */
export const spotifyArtists = sqliteTable("spotify_artists", {
  artistSlug: text("artist_slug").primaryKey(),
  spotifyId: text("spotify_id").notNull(),
  /** musicbrainz｜picks｜search｜manual */
  source: text("source").notNull(),
  evidence: text("evidence").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  /** JSON string[]：專輯＋單曲 ID（market=TW），7 天更新一次 */
  albums: text("albums"),
  albumsAt: text("albums_at"),
  /** 最近一次抽歌的台灣日期 YYYY-MM-DD（沒抽到也記，隔天再抽） */
  drawnOn: text("drawn_on"),
  /** 目前這位藝人的那一首（首頁用） */
  trackId: text("track_id"),
  title: text("title"),
  albumName: text("album_name"),
  updatedAt: text("updated_at").notNull().default(now),
});

/** 抽歌池：每次抽到的歌都留一列（歷史，也用來避免同一位連續抽到同一首） */
export const spotifyDraws = sqliteTable(
  "spotify_draws",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    artistSlug: text("artist_slug").notNull(),
    trackId: text("track_id").notNull(),
    title: text("title").notNull().default(""),
    albumId: text("album_id").notNull().default(""),
    albumName: text("album_name").notNull().default(""),
    /** 台灣日期 YYYY-MM-DD */
    drawnOn: text("drawn_on").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("spotify_draws_artist_idx").on(t.artistSlug, t.id), index("spotify_draws_day_idx").on(t.drawnOn)],
);

/** 抽歌排程狀態（key-value）：backoff_until（429 退避到何時）、pending_bump、last_run */
export const spotifyState = sqliteTable("spotify_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

/**
 * Spotify 專輯曲目快取（2026-09-30）：development mode 的配額按 endpoint 分桶、數字不公開
 * （實測 Get Artist's Albums 約 100 次就被鎖 24 小時），抓過的專輯曲目永久存著，之後從這裡抽不再打 Spotify。
 * tracks：JSON [{ i: 歌曲ID, n: 曲名, a: 演出者ID[] }]，已先排除伴奏／純音樂／Instrumental／Karaoke 與台灣不能播的。
 */
export const spotifyAlbums = sqliteTable("spotify_albums", {
  albumId: text("album_id").primaryKey(),
  name: text("name").notNull().default(""),
  tracks: text("tracks").notNull().default("[]"),
  fetchedAt: text("fetched_at").notNull().default(now),
});

/**
 * Spotify 藝人自動比對（2026-10-03，drizzle/0030；lib/server/spotify-auto.ts）：一位藝人一列。
 * 原則（使用者 10/03）：藝人頁有對外顯示的才配，沒顯示的等出現再配。
 * status：
 *   queued＝等排程比對（觸發 A：藝人頁從不顯示變顯示；觸發 B：每月一次重跑顯示中但沒 ID 的）
 *   done＝比對過（對到就寫進 spotify_artists，source='auto'）
 *   waiting＝藝人頁還沒顯示、使用者已先做過判斷（preset_id 或 rejected_ids），出現時才轉 queued
 *   rejected＝使用者確認整位不配，自動流程永遠不碰
 * outcome：matched｜none（找不到同名）｜doubt（有候選但證據不夠）｜shell（候選沒照片沒作品）｜gone（藝人已刪）
 * 沒有內容版本觸發器：比對寫入後由程式讓 content_version 加 1 一次
 */
export const spotifyMatch = sqliteTable(
  "spotify_match",
  {
    artistSlug: text("artist_slug").primaryKey(),
    status: text("status").notNull().default("queued"),
    /** visible｜monthly｜seed｜manual */
    reason: text("reason").notNull().default("visible"),
    outcome: text("outcome"),
    /** 對到的 Spotify ID，或最後一次的證據說明 */
    spotifyId: text("spotify_id"),
    note: text("note").notNull().default(""),
    /** 使用者確認過、藝人頁出現時直接用的 Spotify ID */
    presetId: text("preset_id"),
    presetNote: text("preset_note").notNull().default(""),
    /** JSON string[]：確定不是本人的 Spotify ID */
    rejectedIds: text("rejected_ids").notNull().default("[]"),
    tries: integer("tries").notNull().default(0),
    nextAt: text("next_at").notNull().default(now),
    checkedAt: text("checked_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("spotify_match_queue_idx").on(t.status, t.nextAt)],
);

/* =====================================================================
 * 發布時自動補資料（2026-09-30，drizzle/0025）：兩張新表，都沒有內容版本觸發器。
 * 會員（或管理員）在炫收藏表單新增藝人、系列、版本時排一筆工作，Worker 在背景查 MusicBrainz／Wikidata：
 *   高信心（條碼吻合，或名稱＋年份＋作品吻合）→ 只補空白欄位（applied 存改前的值，駁回時還原）
 *   低信心 → 只列候選連結；查不到 → 標未查到。細節見 lib/server/autofill.ts 開頭
 * ===================================================================== */

/**
 * 一筆新增一筆工作（addition_id 對 catalog_additions.id）。
 * status：queued｜done｜error；confidence：high｜low｜none｜dup（跟既有資料重複，建議改掛）；
 * decision：NULL｜approved｜rejected（管理員在後台按的）。
 * result：JSON { summary, fields: {欄位: 值}[], sources: {label,url}[], candidates: {label,url,note,mbid?}[], dup?: {into,label,url} }
 * applied：JSON 改前的值與這次建的版本／品項 id（駁回時照這份還原）
 */
export const autofillJobs = sqliteTable(
  "autofill_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    additionId: integer("addition_id").notNull(),
    type: text("type").notNull(),
    ref: text("ref").notNull(),
    status: text("status").notNull().default("queued"),
    confidence: text("confidence"),
    result: text("result").notNull().default("{}"),
    applied: text("applied").notNull().default("{}"),
    decision: text("decision"),
    /** 管理員手動指定的 MBID 或條碼（重查時帶入） */
    hint: text("hint"),
    tries: integer("tries").notNull().default(0),
    nextAt: text("next_at").notNull().default(now),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("autofill_jobs_addition_uq").on(t.additionId), index("autofill_jobs_status_idx").on(t.status, t.nextAt)],
);

/** 自動補資料的狀態（鎖與 MusicBrainz 上次呼叫時間）：key＝lock｜mb_last */
export const autofillState = sqliteTable("autofill_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

/** 私訊封鎖（2026-10-01）：blocker 封鎖 blocked 後，兩人之間都不能再傳訊息、開新對話；設定頁可解除 */
export const userBlocks = sqliteTable(
  "user_blocks",
  {
    blockerId: text("blocker_id").notNull(),
    blockedId: text("blocked_id").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("user_blocks_blocked_idx").on(t.blockedId)],
);

/**
 * 私訊檢舉（2026-10-01）：一人對一條對話一次。後台只看誰檢舉誰、理由與補充，不讀訊息內容。
 * reason：harass｜scam｜spam｜other；status：open｜done
 */
export const dmReports = sqliteTable(
  "dm_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id").notNull(),
    reporterId: text("reporter_id").notNull(),
    reportedId: text("reported_id").notNull(),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("open"),
    handledBy: text("handled_by"),
    handledAt: text("handled_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("dm_reports_thread_reporter_uq").on(t.threadId, t.reporterId),
    index("dm_reports_status_idx").on(t.status, t.id),
    index("dm_reports_reported_idx").on(t.reportedId),
  ],
);

/**
 * 條款同意紀錄（2026-10-01，drizzle/0027）：只增不改。via：register（註冊勾選）｜update（舊會員補同意視窗）。
 * 刪除帳號時保留（證明當時同意過哪一版），user_id 已是匿名帳號，不含 Email
 */
export const termsConsents = sqliteTable(
  "terms_consents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    version: text("version").notNull(),
    via: text("via").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("terms_consents_user_idx").on(t.userId, t.id)],
);

/**
 * 權利侵害通知（2026-10-01，drizzle/0027；著作權法第 90 條之 4 起、使用條款第 11 條）。
 * 流程：通知人在 /takedown 送出（不用登入）→ 管理員移除內容並通知會員（status=removed）或不成立（rejected）
 * → 會員 10 日內可送回復通知（counter_at）→ 管理員轉送通知人（forwarded_at，restore_due＝10 個工作日後）
 * → 期滿通知人沒提出起訴證明就回復（restored），有就維持（upheld）。
 * 每一步都記在 events（JSON 陣列：{ at, by, action, note }），後台可以看完整處理過程。
 * shares＝這則通知對到的炫收藏流水號（JSON 陣列，從網址解析）；member_id＝被通知的會員；strike＝有沒有計入侵權次數
 */
export const takedownNotices = sqliteTable(
  "takedown_notices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    status: text("status").notNull().default("pending"),
    claimantName: text("claimant_name").notNull(),
    claimantEmail: text("claimant_email").notNull(),
    claimantPhone: text("claimant_phone").notNull().default(""),
    claimantAddress: text("claimant_address").notNull().default(""),
    role: text("role").notNull(),
    rightType: text("right_type").notNull(),
    work: text("work").notNull(),
    urls: text("urls").notNull().default("[]"),
    detail: text("detail").notNull(),
    shares: text("shares").notNull().default("[]"),
    memberId: text("member_id"),
    counterText: text("counter_text"),
    counterAt: text("counter_at"),
    forwardedAt: text("forwarded_at"),
    restoreDue: text("restore_due"),
    strike: integer("strike").notNull().default(0),
    events: text("events").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("takedown_notices_status_idx").on(t.status, t.id), index("takedown_notices_member_idx").on(t.memberId)],
);

/**
 * 全家福合集的標記（2026-10-01，drizzle/0028）：一則合集標了哪些專輯。
 * target_key＝系列鍵 `{藝人}/{流水號}`（不確定版本）或版本鍵 `{藝人}/{流水號}#{品項}-{版本}`；同一則同一個鍵只有一列。
 * photo_id／x／y 選填：在照片上點的位置（照片左上角為 0、右下角為 1 的比例），只列清單時是 NULL。
 * 有內容版本觸發器（合集頁、系列頁「出現在 N 個合集中」都在整頁快取裡）。
 */
export const collectionTags = sqliteTable(
  "collection_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareNo: integer("share_no").notNull(),
    targetKey: text("target_key").notNull(),
    sort: integer("sort").notNull().default(0),
    photoId: text("photo_id"),
    x: real("x"),
    y: real("y"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("collection_tags_share_target_uq").on(t.shareNo, t.targetKey), index("collection_tags_target_idx").on(t.targetKey)],
);

/* =====================================================================
 * 2026-10-02 產品顧問總檢（drizzle/0029）：只新增一張表。
 * ===================================================================== */

/**
 * 已刪除帳號的舊帳號名（總檢 L11）：刪帳後舊帳號名不開放別人再註冊、也不能改成這個，避免冒名。
 * 執行刪除帳號時寫入一列；註冊與改帳號名時查。永久保留（帳號名本來就公開，不含 Email）
 */
export const retiredHandles = sqliteTable("retired_handles", {
  handle: text("handle").primaryKey(),
  retiredAt: text("retired_at").notNull().default(now),
});
