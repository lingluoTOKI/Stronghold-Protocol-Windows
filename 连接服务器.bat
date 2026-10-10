@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
REM 连接别人的服务器：输入服务器地址（如 192.168.1.23:3000 或 game.example.com），用浏览器打开
node scripts\launcher.mjs --mode connect %*
pause
