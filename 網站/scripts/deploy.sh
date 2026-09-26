#!/usr/bin/env bash
# 音藏正式部署（Cloudflare Workers：yinzang.dblzm.workers.dev）。
# 順序是閘門：任何一步失敗就停，後面不會跑。先套遷移、再部署程式；遷移前先做站外備份。
#
# 用法（在 網站/ 底下，已 wrangler login 或設好 CLOUDFLARE_API_TOKEN）：
#   scripts/deploy.sh            一般部署
#   scripts/deploy.sh --first    第一次部署（雲端 D1 還是空的，跳過遷移前備份）
# 部署前要先照 產出/20260927_部署手冊.md 建好 D1、R2，填好 wrangler.production.jsonc、設好 secrets。
set -euo pipefail
cd "$(dirname "$0")/.."

FIRST=0
[[ "${1:-}" == "--first" ]] && FIRST=1
CFG=wrangler.production.jsonc
W=(node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js)

step() { printf '\n== %s ==\n' "$1"; }

step "0. 設定檢查"
if grep -q "__填入_" "$CFG"; then
  echo "wrangler.production.jsonc 還有沒填的欄位："; grep -n "__填入_" "$CFG"; exit 1
fi
"${W[@]}" whoami >/dev/null
for s in TURNSTILE_SECRET RESEND_API_KEY BUDGET_WEBHOOK_SECRET; do
  "${W[@]}" secret list --config "$CFG" 2>/dev/null | grep -q "\"$s\"" || { echo "缺 secret：$s（wrangler secret put $s --config $CFG）"; exit 1; }
done

step "1. 型別、lint、遷移檔檢查"
npm run typecheck
npm run lint
if grep -lE "__new_|DROP TABLE|DROP COLUMN|RENAME" drizzle/*.sql; then echo "遷移檔有重建表或刪除語句，停止"; exit 1; fi

step "2. 建置（正式設定）"
rm -rf dist
YINZANG_DEPLOY=production npm run build

if [[ $FIRST -eq 0 ]]; then
  step "3. 遷移前站外備份"
  node scripts/backup.mjs --remote
else
  step "3. 第一次部署，雲端 D1 是空的，跳過備份"
fi

step "4. 套用遷移（雲端 D1）"
"${W[@]}" d1 migrations apply DB --remote --config "$CFG"
PENDING=$("${W[@]}" d1 migrations list DB --remote --config "$CFG" 2>&1 || true)
if ! grep -q "No migrations to apply" <<<"$PENDING"; then echo "遷移沒有全部套用：$PENDING"; exit 1; fi

step "5. 部署程式"
"${W[@]}" deploy --config dist/server/wrangler.json

step "6. 煙霧測試"
URL="https://yinzang.dblzm.workers.dev"
curl -fsS -o /dev/null "$URL/" && echo "首頁 200"
curl -fsS -D - -o /dev/null "$URL/" | grep -qi "^x-robots-tag: noindex" && echo "X-Robots-Tag noindex"
curl -fsS "$URL/" | grep -q '<meta name="robots" content="noindex"' && echo "meta robots noindex"
curl -fsS "$URL/robots.txt" | grep -q "Disallow: /admin" && echo "robots.txt 正常"
echo "部署完成。接著照部署手冊跑「部署後檢查」。"
