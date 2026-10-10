@echo off
setlocal
set "HERE=%~dp0"

set "SP_ADMIN_TOKEN=tYP6cVr7KO8eTlDLZbF2xwhI"
set "PORT=3000"

echo.
echo ============================================
echo   Stronghold Protocol - Local Server (Local Test)
echo   URL:   http://127.0.0.1:%PORT%
echo   Admin Token: %SP_ADMIN_TOKEN%
echo   In monitor.html use the same token and turn Local Test ON.
echo ============================================
echo.

set "NODE="
if exist "%HERE%node\node.exe" set "NODE=%HERE%node\node.exe"
if not defined NODE set "NODE=node"

"%NODE%" "%HERE%server\index.js"
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%
