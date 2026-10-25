@echo off
rem Start the backend in a new console window (development/debug).
rem Publish root resolution: HOLIDAY_GUIDE_PUBLISH env, otherwise ..\publish
setlocal
if defined HOLIDAY_GUIDE_PUBLISH (set "PUB=%HOLIDAY_GUIDE_PUBLISH%") else (set "PUB=%~dp0..\publish")
set "EXE=%PUB%\backend\HolidayGuideBackend.exe"
if not exist "%EXE%" (
  echo [ERROR] not found: %EXE%
  echo         set HOLIDAY_GUIDE_PUBLISH to your publish root
  exit /b 1
)
cd /d "%PUB%\backend"
start "HolidayGuideBackend" HolidayGuideBackend.exe
exit /b 0
