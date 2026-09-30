@echo off
rem 樂迷藏正式部署（Windows）。實際流程在 deploy.sh，這支交給 Git Bash／WSL 執行，確保閘門行為一致。
rem 用法：scripts\deploy.bat [--first] [--smoke-only] [--url https://網址]（參數說明見 deploy.sh 開頭）
chcp 65001 >nul
cd /d "%~dp0.."
where bash >nul 2>nul || (echo 需要 Git Bash 或 WSL 的 bash & exit /b 1)
bash scripts/deploy.sh %*
exit /b %errorlevel%
