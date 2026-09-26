#!/usr/bin/env bash
# 音藏備份（Mac／Linux／WSL）。用法：scripts/backup.sh --remote（正式）或 --local（本機試跑）
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/backup.mjs "$@"
