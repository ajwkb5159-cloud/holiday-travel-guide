@echo off
rem Register HolidayGuideUpdater as a Windows service (administrator).
rem Usage:
rem   install-updater-service.bat [path\to\HolidayGuideUpdater.exe]
rem   set HOLIDAY_GUIDE_PUBLISH=<publish-root>  (optional)
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] run this script as administrator
  exit /b 1
)

set "SVC=HolidayGuideUpdater"
set "EXE=%~1"
if not defined EXE if defined HOLIDAY_GUIDE_PUBLISH set "EXE=%HOLIDAY_GUIDE_PUBLISH%\updater\HolidayGuideUpdater.exe"
if not defined EXE set "EXE=%~dp0..\publish\updater\HolidayGuideUpdater.exe"

if not exist "%EXE%" (
  echo [ERROR] not found: %EXE%
  echo         pass the exe path as the first argument or set HOLIDAY_GUIDE_PUBLISH
  exit /b 2
)

sc.exe query "%SVC%" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] service %SVC% already exists, stopping and deleting it first
  sc.exe stop "%SVC%" >nul 2>&1
  timeout /t 3 /nobreak >nul
  sc.exe delete "%SVC%" >nul 2>&1
)

sc.exe create "%SVC%" binPath= "\"%EXE%\"" start= auto DisplayName= "Holiday Guide Updater"
if errorlevel 1 ( echo [ERROR] sc create failed & exit /b 3 )
sc.exe description "%SVC%" "Holiday Travel Guide monthly data ingestion worker" >nul
sc.exe failure "%SVC%" reset= 86400 actions= restart/5000/restart/10000/restart/30000 >nul
sc.exe start "%SVC%"
sc.exe query "%SVC%"
exit /b 0
