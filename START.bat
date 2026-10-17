@echo off
chcp 65001 >nul
title Stronghold Protocol - One-Click Launcher (v0.3.0)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(process.versions.node.split('.')[0] >= 22 ? 0 : 1)"
if errorlevel 1 goto :oldnode

echo.
echo ============================================================
echo   卫戍协议：盟约  一键启动  (v0.3.0)
echo   Project: %CD%
echo ============================================================
echo.
echo [1/3] 关闭可能残留的旧服务器（端口 3000）...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo       结束进程 PID %%p
  taskkill /f /pid %%p >nul 2>nul
)
echo [2/3] 启动服务器 ...
echo [3/3] 稍后自动打开浏览器 http://localhost:3000
echo.
echo 本窗口请保持打开（关掉 = 停止服务器）。Ctrl+C 亦可停止。
echo ------------------------------------------------------------
echo.

node scripts\launch.mjs --no-setup
if errorlevel 1 goto :fail
goto :end

:nonode
echo.
echo [错误] 未找到 Node.js（需要 22 或更高，22 / 24 LTS）。
echo   安装：winget install OpenJS.NodeJS.LTS
echo   或：  https://nodejs.org/zh-cn/download
echo.
goto :end

:oldnode
echo.
echo [错误] Node.js 版本太旧，需要 22 或更高。
echo   升级：winget upgrade OpenJS.NodeJS.LTS
echo.
goto :end

:fail
echo.
echo [错误] 启动失败，请看上面的错误信息。
echo   诊断：node tools\doctor.mjs
echo.

:end
echo.
echo 服务器已停止，可关闭本窗口。
pause
