@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
REM 打开启动器菜单：[1]本机当服务器 [2]连接服务器 [3]设置 [4]查看状态
node scripts\launcher.mjs %*
pause
