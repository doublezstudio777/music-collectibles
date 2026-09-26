import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  // 本機用 Cloudflare Turnstile 官方測試金鑰（永遠通過）；要測失敗時設
  // TURNSTILE_SECRET=2x0000000000000000000000000000000AA 再冷啟動。寄信本機一律印在 console。
  vars: {
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
    TURNSTILE_SECRET: process.env.TURNSTILE_SECRET ?? "1x0000000000000000000000000000000AA",
    MAIL_MODE: process.env.MAIL_MODE ?? "console",
    // 管理員名單（逗號分隔 Email）。本機預設一個測試管理員；正式用 wrangler 設成 zukawork0312@gmail.com
    ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? "admin@demo.yinzang.test",
    // 2c：預算通知 webhook 的共用密鑰（本機固定測試值；正式用 wrangler secret）
    BUDGET_WEBHOOK_SECRET: process.env.BUDGET_WEBHOOK_SECRET ?? "local-webhook-secret",
    // 2c：不給搜尋引擎收錄，"1" 才開放
    ALLOW_INDEXING: process.env.ALLOW_INDEXING ?? "0",
    PBKDF2_ITERATIONS: process.env.PBKDF2_ITERATIONS ?? "100000",
    // 2c：本機預設不寄真信（沒有 RESEND_API_KEY＝印 console）。真實寄信測試時才用環境變數帶進來，並用 MAIL_ALLOWLIST 限收件人
    ...(process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY } : {}),
    ...(process.env.MAIL_ALLOWLIST ? { MAIL_ALLOWLIST: process.env.MAIL_ALLOWLIST } : {}),
  },
  // 照片：本機 Miniflare 模擬 R2（與 D1 同放 .wrangler/state），雲端 0 個 bucket
  r2_buckets: [
    { binding: "PHOTOS", bucket_name: "yinzang-photos" },
    ...(r2 ? [{ binding: r2, bucket_name: "site-creator-r2" }] : []),
  ],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      // 正式部署（scripts/deploy.sh 設 YINZANG_DEPLOY=production）讀 wrangler.production.jsonc；
      // 其餘（本機 dev）用上面的本機設定，雲端 0 資源。檔名刻意不叫 wrangler.jsonc，免得本機 dev 自動讀到正式設定
      process.env.YINZANG_DEPLOY === "production"
        ? cloudflare({
            viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
            inspectorPort: false,
            configPath: "./wrangler.production.jsonc",
          })
        : cloudflare({
            viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
            inspectorPort: false,
            config: localBindingConfig,
          }),
    ],
  };
});
