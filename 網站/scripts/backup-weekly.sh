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
{
  echo "== $(date '+%Y-%m-%d %H:%M:%S') 每週備份開始"
  if node scripts/backup.mjs --remote; then echo "== 完成"; else echo "== 失敗（exit $?）"; exit 1; fi
} >> "$LOG_DIR/backup.log" 2>&1
