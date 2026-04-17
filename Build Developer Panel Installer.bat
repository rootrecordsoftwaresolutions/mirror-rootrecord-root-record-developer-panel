@echo off
setlocal

REM Build the Root Record Developer Panel installer from this project folder.
cd /d "%~dp0"

echo.
echo ===============================================
echo Building Root Record Developer Panel Installer
echo ===============================================
echo.

call npm run build:installer
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Build complete.
echo Installer output is in:
echo   %~dp0dist-installer
echo.
pause
exit /b 0
