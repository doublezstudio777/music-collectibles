declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET?: string;
    /** console（本機，印在終端機）｜之後接的寄信服務名稱 */
    MAIL_MODE?: string;
    /** 照片（R2）。本機由 Miniflare 模擬，存在 .wrangler/state */
    PHOTOS?: R2Bucket;
    /** 管理員 Email，逗號分隔；必須是已驗證 Email 的帳號 */
    ADMIN_EMAILS?: string;
  }
}
