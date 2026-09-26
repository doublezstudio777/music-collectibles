@echo off
rem 音藏備份（Windows）。用法：scripts\backup.bat --remote（正式）或 --local（本機試跑）
chcp 65001 >nul
cd /d "%~dp0.."
node scripts\backup.mjs %*
exit /b %errorlevel%
