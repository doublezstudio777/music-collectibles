declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET?: string;
    /** console（本機，印在終端機）｜之後接的寄信服務名稱 */
    MAIL_MODE?: string;
  }
}
