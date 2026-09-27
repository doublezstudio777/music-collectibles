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
    /** 2c：有設就用 Resend 寄信，沒設印在 console（secret） */
    RESEND_API_KEY?: string;
    /** 寄件人與回覆地址（不設用 services.ts 的預設） */
    MAIL_FROM?: string;
    MAIL_REPLY_TO?: string;
    /** 本機真實寄信測試用：只寄給名單裡的人，其他印 console。正式環境不設 */
    MAIL_ALLOWLIST?: string;
    /** 預算通知 webhook 的共用密鑰（Cloudflare 放在 cf-webhook-auth 表頭）（secret） */
    BUDGET_WEBHOOK_SECRET?: string;
    /** 搜尋引擎收錄開關："1" 才開放，預設 noindex */
    ALLOW_INDEXING?: string;
    /** 密碼雜湊次數（10,000～100,000，預設 100,000） */
    PBKDF2_ITERATIONS?: string;
    /** 本機測試模式（只在 vite.config.ts 的本機設定裡）："1" 時連線國家可用表頭／cookie 模擬、IP 限流只算帶測試表頭的請求。正式環境絕不設 */
    LOCAL_TEST?: string;
    /** 本機沒帶模擬國家時的預設國家（預設 TW） */
    GEO_DEFAULT?: string;
    /** 管理後台用量：Cloudflare GraphQL Analytics 唯讀金鑰（secret，權限只要 Account Analytics: Read）。沒設顯示「未設定」 */
    CF_ANALYTICS_TOKEN?: string;
    CF_ACCOUNT_ID?: string;
  }
}
