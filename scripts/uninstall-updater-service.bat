@echo off
rem Unregister HolidayGuideUpdater Windows service (administrator).
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] run this script as administrator
  exit /b 1
)

set "SVC=HolidayGuideUpdater"
sc.exe stop "%SVC%" >nul 2>&1
timeout /t 3 /nobreak >nul
sc.exe delete "%SVC%"
if errorlevel 1 ( echo [ERROR] sc delete failed or service does not exist & exit /b 2 )
echo [OK] service %SVC% removed
exit /b 0
