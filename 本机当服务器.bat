@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
REM 在本机当服务器：监听 0.0.0.0，局域网内朋友用 http://<本机IP>:3000 加入
set HOST=0.0.0.0
echo [本机开服] 监听 0.0.0.0:3000，控制台会打印可分享的局域网地址。
node scripts\launcher.mjs --mode local %*
pause
