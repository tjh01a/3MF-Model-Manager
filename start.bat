@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
rem Some host apps inject ELECTRON_RUN_AS_NODE=1, which turns Electron into plain Node.
set "ELECTRON_RUN_AS_NODE="
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies for first launch, please wait...
  call npm install --no-audit --no-fund
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo ERROR: Electron not found. Please run: npm install
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
exit /b 0
