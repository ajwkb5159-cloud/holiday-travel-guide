@echo off
rem =====================================================================
rem  Register / remove the monthly data generation scheduled tasks
rem  Usage : install-monthly-task.bat          (register, needs admin)
rem          install-monthly-task.bat remove   (unregister)
rem ---------------------------------------------------------------------
rem  HolidayGuideMonthlyDataGen         : monthly, day 1, 02:00
rem  HolidayGuideMonthlyDataGenCatchup  : daily, 12:00 (skips when done)
rem  Both run scripts\run-monthly-data.bat as SYSTEM (no logon required);
rem  the script itself is idempotent and skips a month already delivered.
rem =====================================================================
setlocal EnableExtensions
chcp 65001 >nul
set "HERE=%~dp0"
set "BAT=%HERE%run-monthly-data.bat"
set "T1=HolidayGuideMonthlyDataGen"
set "T2=HolidayGuideMonthlyDataGenCatchup"

if /i "%~1"=="remove" goto remove

if not exist "%BAT%" (
  echo [ERROR] not found: %BAT%
  exit /b 2
)

schtasks /Create /F /TN "%T1%" /TR "\"%BAT%\"" /SC MONTHLY /D 1 /ST 02:00 /RU SYSTEM /RL HIGHEST
if errorlevel 1 (echo [ERROR] create %T1% failed & exit /b 1)

schtasks /Create /F /TN "%T2%" /TR "\"%BAT%\"" /SC DAILY /ST 12:00 /RU SYSTEM /RL HIGHEST
if errorlevel 1 (echo [ERROR] create %T2% failed & exit /b 1)

echo.
echo [OK] registered:
schtasks /Query /TN "%T1%" /FO LIST | findstr /i "TaskName Next Status"
schtasks /Query /TN "%T2%" /FO LIST | findstr /i "TaskName Next Status"
echo.
echo Manual run now : schtasks /Run /TN "%T1%"
echo Force rebuild  : "%BAT%" --force
exit /b 0

:remove
schtasks /Delete /F /TN "%T1%"
schtasks /Delete /F /TN "%T2%"
echo [OK] removed %T1% / %T2%
exit /b 0
