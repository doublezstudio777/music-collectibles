#!/usr/bin/env bash
# 樂迷藏每週備份（給 Windows 工作排程器經 wsl.exe 呼叫）。
# 從 _私人/cloudflare.txt 讀 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID（不印出），跑正式環境備份，結果附加到備份資料夾的 backup.log。
# 憑證檔位置可用環境變數 YINZANG_CF_ENV 改；預設是 Windows 主力機的 OneDrive 路徑。
set -euo pipefail
cd "$(dirname "$0")/.."
CF_ENV="${YINZANG_CF_ENV:-/mnt/d/OneDrive/Claude-Data/_個人資料/音藏/_私人/cloudflare.txt}"
LOG_DIR="${YINZANG_BACKUP_DIR:-/mnt/d/OneDrive/Claude-Data/_個人資料/音藏/備份}"
mkdir -p "$LOG_DIR"
# 排程器經 wsl.exe 叫起來時不會讀 .bashrc，nvm 裝的 node 不在 PATH
if ! command -v node >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi
set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < "$CF_ENV")
set +a
# 失敗時用 Resend 寄一封給管理員（2026-10-02 總檢 S11）：金鑰從 _私人/resend.txt 讀（RESEND_API_KEY=…），讀不到就只寫 log
RESEND_ENV="${YINZANG_RESEND_ENV:-$(dirname "$CF_ENV")/resend.txt}"
ALERT_TO="${YINZANG_ALERT_TO:-zukawork0312@gmail.com}"
alert() {
  local subject="$1" body="$2" key=""
  [[ -r "$RESEND_ENV" ]] && key=$(tr -d '\r' < "$RESEND_ENV" | sed -n 's/^RESEND_API_KEY=//p' | head -n1)
  [[ -n "$key" ]] || { echo "== 沒有 Resend 金鑰，無法寄警示信"; return 0; }
  curl -sS -m 30 -o /dev/null -w "== 警示信 HTTP %{http_code}\n" https://api.resend.com/emails \
    -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
    --data "$(python3 -c 'import json,sys; print(json.dumps({"from":"樂迷藏 <noreply@notify.dblzm.com>","to":[sys.argv[1]],"subject":sys.argv[2],"text":sys.argv[3]}, ensure_ascii=False))' "$ALERT_TO" "$subject" "$body")" || true
}
{
  echo "== $(date '+%Y-%m-%d %H:%M:%S') 每週備份開始"
  if node scripts/backup.mjs --remote; then
    echo "== 完成"
  else
    rc=$?
    echo "== 失敗（exit $rc）"
    alert "樂迷藏：每週備份失敗" "$(date '+%Y-%m-%d %H:%M') 的每週備份失敗（exit $rc）。請到 $LOG_DIR/backup.log 看原因，手動跑 網站/scripts/backup.sh 補一次。"
    exit 1
  fi
  # 刪帳後保留照片的浮水印重燒（2026-10-02 總檢 L12）：每週順手把還沒重燒的刪帳申請跑完，不用管理員記得手動跑
  if command -v python3 >/dev/null; then
    echo "== 刪帳照片浮水印重燒檢查"
    python3 scripts/reburn-watermark.py --remote --pending-deletions --skip-backup || alert "樂迷藏：刪帳照片浮水印重燒失敗" "每週備份後的浮水印重燒（reburn-watermark.py --pending-deletions）失敗，請看 $LOG_DIR/backup.log。"
  fi
} >> "$LOG_DIR/backup.log" 2>&1
