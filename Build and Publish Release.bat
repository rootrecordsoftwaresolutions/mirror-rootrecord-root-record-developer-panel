@echo off
setlocal

cd /d "%~dp0"

echo.
echo ===================================================
echo Build + Publish Root Record Developer Panel Release
echo (Auto-bumps patch version first)
echo ===================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\release-oneclick.ps1"
if errorlevel 1 (
  echo.
  echo Release pipeline failed.
  pause
  exit /b 1
)

echo.
echo Release pipeline completed successfully.
pause
exit /b 0
