@echo off
rem Run the updater once in console mode (debug).
rem Usage: start-updater-console.bat [yyyyMM]
rem Publish root resolution: HOLIDAY_GUIDE_PUBLISH env, otherwise ..\publish
setlocal
if defined HOLIDAY_GUIDE_PUBLISH (set "PUB=%HOLIDAY_GUIDE_PUBLISH%") else (set "PUB=%~dp0..\publish")
set "EXE=%PUB%\updater\HolidayGuideUpdater.exe"
if not exist "%EXE%" (
  echo [ERROR] not found: %EXE%
  echo         set HOLIDAY_GUIDE_PUBLISH to your publish root
  exit /b 1
)
cd /d "%PUB%\updater"
if "%~1"=="" (
  HolidayGuideUpdater.exe --run-once
) else (
  HolidayGuideUpdater.exe --run-once --month %1
)
exit /b %ERRORLEVEL%
