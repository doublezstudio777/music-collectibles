#!/usr/bin/env bash
# 樂迷藏正式部署（Cloudflare Workers：正式網域 lemibox.com，舊網址 yinzang.dblzm.workers.dev 照常保留）。
# 順序是閘門：任何一步失敗就停，後面不會跑。先套遷移、再部署程式；遷移前先做站外備份。
#
# 用法（在 網站/ 底下，已 wrangler login 或設好 CLOUDFLARE_API_TOKEN）：
#   scripts/deploy.sh                        一般部署，煙霧測試驗預設兩個網址（新網域＋舊 workers.dev）
#   scripts/deploy.sh --first                第一次部署（雲端 D1 還是空的，跳過遷移前備份）
#   scripts/deploy.sh --url https://X ...    煙霧測試只驗指定網址（可重複給多個 --url）
#   scripts/deploy.sh --smoke-only [--url …] 不建置不部署，只對現在線上的版本跑第 6、7 步（驗新網址、查問題用）
# 煙霧測試的收錄斷言跟著 wrangler.production.jsonc 的 ALLOW_INDEXING 走：0＝必須有 noindex，1＝必須沒有 noindex。
# 驗 lemibox.com 時另外驗 www.lemibox.com 與 http:// 都會 301 到 https apex（worker.ts）。
# 部署前要先照 產出/20260927_部署手冊.md 建好 D1、R2，填好 wrangler.production.jsonc、設好 secrets。
set -euo pipefail
cd "$(dirname "$0")/.."

FIRST=0
SMOKE_ONLY=0
URLS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --first) FIRST=1 ;;
    --smoke-only) SMOKE_ONLY=1 ;;
    --url) [[ -n "${2:-}" ]] || { echo "--url 後面要接網址"; exit 2; }; URLS+=("${2%/}"); shift ;;
    *) echo "不認得的參數：$1"; exit 2 ;;
  esac
  shift
done
[[ ${#URLS[@]} -gt 0 ]] || URLS=("https://lemibox.com" "https://yinzang.dblzm.workers.dev")
CFG=wrangler.production.jsonc
W=(node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js)
INDEXING=$(grep -oE '"ALLOW_INDEXING": *"[01]"' "$CFG" | grep -oE '[01]"$' | tr -d '"')
[[ "$INDEXING" == "0" || "$INDEXING" == "1" ]] || { echo "讀不到 $CFG 的 ALLOW_INDEXING"; exit 1; }

step() { printf '\n== %s ==\n' "$1"; }

if [[ $SMOKE_ONLY -eq 0 ]]; then
step "0. 設定檢查"
if grep -q "__填入_" "$CFG"; then
  echo "wrangler.production.jsonc 還有沒填的欄位："; grep -n "__填入_" "$CFG"; exit 1
fi
if grep -q "LOCAL_TEST" "$CFG"; then echo "正式設定不能有 LOCAL_TEST（本機測試模式，會讓國家與限流可以被偽造）"; exit 1; fi
"${W[@]}" whoami >/dev/null
for s in TURNSTILE_SECRET RESEND_API_KEY BUDGET_WEBHOOK_SECRET; do
  SECRETS=$("${W[@]}" secret list --config "$CFG" 2>/dev/null || true)
  grep -q "\"$s\"" <<<"$SECRETS" || { echo "缺 secret：$s（wrangler secret put $s --config $CFG）"; exit 1; }
done

step "1. 型別、lint、遷移檔檢查"
npm run typecheck
npm run lint
if grep -lE "__new_|DROP TABLE|DROP COLUMN|RENAME" drizzle/*.sql; then echo "遷移檔有重建表或刪除語句，停止"; exit 1; fi

step "2. 建置（正式設定）"
rm -rf dist
YINZANG_DEPLOY=production npm run build
if grep -q "LOCAL_TEST" dist/server/wrangler.json; then echo "建置結果帶了 LOCAL_TEST，停止"; exit 1; fi
# 正式網域綁定寫在 routes（custom_domain）；建置後的設定檔一定要還帶著，不然部署可能把網域綁定拿掉
grep -q '"lemibox.com"' dist/server/wrangler.json && grep -q '"custom_domain"' dist/server/wrangler.json || { echo "建置結果沒有帶 lemibox.com 的 routes，停止"; exit 1; }
# 上一版的 JS／CSS 保留 7 天一起部署：新版本傳開前，舊版本回的舊 HTML 還指著舊檔（理由見 scripts/keep-assets.mjs 開頭）
node scripts/keep-assets.mjs merge

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
"${W[@]}" deploy --config dist/server/wrangler.json | tee .wrangler/deploy-output.txt
VID=$(grep -oE 'Current Version ID: [0-9a-f-]+' .wrangler/deploy-output.txt | awk '{print $4}')
[[ -n "$VID" ]] || { echo "抓不到這次的版本號"; exit 1; }
node scripts/keep-assets.mjs save

fi

# 煙霧測試（一個網址跑一輪）：收錄斷言依 ALLOW_INDEXING；VID 有值才等新版本生效
smoke() {
  local URL="$1"
  # 先等新版本傳開（首頁由新版本回、引用的資產全部 200）再驗：過渡期舊版本還會回應，轉址這類新行為會時有時無（理由見 scripts/wait-live.py）
  if [[ -n "${VID:-}" ]]; then
    step "6a. 等新版本 $VID 在 $URL 生效"
    python3 scripts/wait-live.py "$URL" "$VID" || { echo "新版本 90 秒內沒有穩定生效"; exit 1; }
  fi
  step "6. 煙霧測試：$URL"
  curl -fsS -m 30 -o /dev/null "$URL/" || { echo "煙霧測試失敗：首頁"; exit 1; }; echo "首頁 200"
  # 先把回應存進變數再 grep：管線裡的 grep -q 提早關閉會讓 curl 收到 SIGPIPE，pipefail 下誤判失敗
  local HEAD BODY ROBOTS
  HEAD=$(curl -fsS -m 30 -D - -o /dev/null "$URL/")
  BODY=$(curl -fsS -m 30 "$URL/")
  if [[ "$INDEXING" == "0" ]]; then
    grep -qi "^x-robots-tag: noindex" <<<"$HEAD" || { echo "煙霧測試失敗：X-Robots-Tag noindex"; exit 1; }; echo "X-Robots-Tag noindex"
    grep -q '<meta name="robots" content="noindex"' <<<"$BODY" || { echo "煙霧測試失敗：meta robots noindex"; exit 1; }; echo "meta robots noindex"
  else
    if grep -qi "^x-robots-tag: noindex" <<<"$HEAD"; then echo "煙霧測試失敗：ALLOW_INDEXING=1 卻還有 X-Robots-Tag noindex"; exit 1; fi; echo "沒有 X-Robots-Tag noindex（開放收錄）"
    if grep -q '<meta name="robots" content="noindex"' <<<"$BODY"; then echo "煙霧測試失敗：ALLOW_INDEXING=1 卻還有 meta robots noindex"; exit 1; fi; echo "沒有 meta robots noindex（開放收錄）"
  fi
  ROBOTS=$(curl -fsS -m 30 "$URL/robots.txt")
  grep -q "Disallow: /admin" <<<"$ROBOTS" || { echo "煙霧測試失敗：robots.txt 正常"; exit 1; }; echo "robots.txt 正常"
  if [[ "$URL" == "https://lemibox.com" ]]; then
    local WWW
    WWW=$(curl -sS -m 30 -o /dev/null -w '%{http_code} %{redirect_url}' "https://www.lemibox.com/artists?x=1")
    [[ "$WWW" == "301 https://lemibox.com/artists?x=1" ]] || { echo "煙霧測試失敗：www 轉址（實際：$WWW）"; exit 1; }; echo "www.lemibox.com 301 到 apex"
    WWW=$(curl -sS -m 30 -o /dev/null -w '%{http_code} %{redirect_url}' "http://lemibox.com/artists?x=1")
    [[ "$WWW" == "301 https://lemibox.com/artists?x=1" ]] || { echo "煙霧測試失敗：http 轉 https（實際：$WWW）"; exit 1; }; echo "http://lemibox.com 301 到 https"
  fi
  # 瀏覽器步驟（2026-09-28 加）：curl 看不出連結點了沒反應，要真的開瀏覽器點一次；失敗整個腳本失敗
  step "7. 瀏覽器煙霧測試：$URL（Playwright：點連結換頁、console error 0）"
  python3 scripts/smoke-browser.py "$URL" || { echo "煙霧測試失敗：瀏覽器步驟（程式已部署，要回復見部署手冊第八節）"; exit 1; }
}

[[ $SMOKE_ONLY -eq 1 ]] && VID=""
for u in "${URLS[@]}"; do smoke "$u"; done
if [[ $SMOKE_ONLY -eq 1 ]]; then echo "煙霧測試完成（${URLS[*]}）"; else echo "部署完成（${VID}）。接著照部署手冊跑「部署後檢查」。"; fi
