@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting Nexora V1...
node server\index.js
pause
