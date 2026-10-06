@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "APP_DIR=%~dp0"
set "RUNTIME=%APPDATA%\Nexora\runtime\node-v22.16.0-win-x64"
set "NODE_EXE=%RUNTIME%\node.exe"
set "NODE_ZIP=%TEMP%\nexora-node-v22.16.0-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip"

if not exist "%NODE_EXE%" (
  echo.
  echo Nexora first-run setup
  echo ---------------------
  echo Downloading the private Node.js runtime automatically...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%'"
  if errorlevel 1 (
    echo.
    echo Download failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path '%RUNTIME%' ^| Out-Null; Expand-Archive -Force -Path '%NODE_ZIP%' -DestinationPath '%APPDATA%\Nexora\runtime'"
  if errorlevel 1 (
    echo.
    echo Runtime extraction failed.
    pause
    exit /b 1
  )
  del /q "%NODE_ZIP%" >nul 2>nul
)

if not exist "%NODE_EXE%" (
  echo Node runtime was not found after setup.
  pause
  exit /b 1
)

echo Starting Nexora...
set "NEXORA_HOME=%APPDATA%\Nexora"
set "NEXORA_NO_BROWSER=0"
"%NODE_EXE%" "%APP_DIR%server\index.js"
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Nexora stopped with exit code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
