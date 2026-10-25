@echo off
rem =====================================================================
rem  Holiday Travel Guide - monthly data generation and delivery (free LLM)
rem ---------------------------------------------------------------------
rem  Usage : run-monthly-data.bat [--force]
rem    (no args) : generate current month, skip when already delivered
rem    --force   : regenerate even if current month already delivered
rem  Steps : 1) node scripts\gen-real.mjs --month <yyyyMM> (provider chain from local config)
rem          2) validate + assemble 120 guides (baseline reuse fallback)
rem          3) xcopy data\<yyyyMM> to publish\updater\data\<yyyyMM>
rem  Local config: scripts\monthly-data.local.bat (gitignored) sets KEYDIR / PUBDIR /
rem                PRIMARY_PROVIDER / FALLBACK_PROVIDER. See monthly-data.local.bat.example.
rem  Log   : <repo>\.test-env\auto-gen-<yyyyMM>.log
rem          failure marker: .test-env\auto-gen-<yyyyMM>.FAILED
rem  Note  : the updater service picks the delivered folder up within 5 min
rem          and publishes it automatically (no service restart needed).
rem  Registered by scripts\install-monthly-task.bat (Task Scheduler, SYSTEM)
rem =====================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

set "HERE=%~dp0"
set "ROOT=%HERE%.."
if exist "%HERE%monthly-data.local.bat" call "%HERE%monthly-data.local.bat"
if not defined KEYDIR set "KEYDIR=%USERPROFILE%"
if not defined PUBDIR set "PUBDIR=%ROOT%\publish\updater\data"
if not defined PRIMARY_PROVIDER set "PRIMARY_PROVIDER=zhipu"
if not defined FALLBACK_PROVIDER set "FALLBACK_PROVIDER=siliconflow"
set "HOLIDAY_GUIDE_KEY_DIR=%KEYDIR%"
set "FORCE=0"
if /i "%~1"=="--force" set "FORCE=1"

set "SIX="
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMM')"') do set "SIX=%%i"
if "!SIX!"=="" (
  echo [ERROR] cannot resolve current month
  exit /b 2
)

set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
if not defined NODE (
  echo [ERROR] node.exe not found
  exit /b 2
)

set "LOGDIR=%ROOT%\.test-env"
if not exist "!LOGDIR!" mkdir "!LOGDIR!"
set "LOG=!LOGDIR!\auto-gen-!SIX!.log"
set "FAIL=!LOGDIR!\auto-gen-!SIX!.FAILED"
set "SRC=%ROOT%\HolidayGuideUpdater\data\!SIX!"

echo.>>"!LOG!"
echo ================ !DATE! !TIME! run-monthly-data month=!SIX! force=!FORCE! ================>>"!LOG!"
echo [INFO] node=!NODE!>>"!LOG!"
echo [INFO] keyDir=!KEYDIR! publishDir=!PUBDIR!>>"!LOG!"
echo [INFO] provider=!PRIMARY_PROVIDER! fallback=!FALLBACK_PROVIDER!>>"!LOG!"

if "!FORCE!"=="0" if exist "!PUBDIR!\!SIX!\guides.json" (
  echo [SKIP] !PUBDIR!\!SIX!\guides.json already exists, nothing to do>>"!LOG!"
  echo [SKIP] month !SIX! already delivered
  exit /b 0
)

if exist "!FAIL!" del "!FAIL!"

echo [GEN] "!NODE!" "%ROOT%\scripts\gen-real.mjs" --month !SIX!>>"!LOG!"
echo [SMOKE] primary channel !PRIMARY_PROVIDER! preflight - no fallback, single piece>>"!LOG!"
"!NODE!" "%ROOT%\scripts\gen-real.mjs" --month !SIX! --smoke beijing-zhongqiu --provider !PRIMARY_PROVIDER! --no-fallback --key-dir "!KEYDIR!" >>"!LOG!" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo [FAIL] primary channel !PRIMARY_PROVIDER! preflight failed with exit !RC!>>"!LOG!"
  echo [FAIL] delivery skipped on purpose: fallback channels are lower quality, do not publish them automatically.>>"!LOG!"
  echo [FAIL] fix: check key files under !KEYDIR! (expected .zhipu.key / .siliconflow.key / .dashscope.key) - then rerun.>>"!LOG!"
  echo failed !DATE! !TIME! smoke preflight exit=!RC! - see log>>"!FAIL!"
  exit /b 1
)

echo [GEN] full run with fallback chain>>"!LOG!"
"!NODE!" "%ROOT%\scripts\gen-real.mjs" --month !SIX! --provider !PRIMARY_PROVIDER! --fallback-provider !FALLBACK_PROVIDER! --concurrency 3 --key-dir "!KEYDIR!" >>"!LOG!" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo [FAIL] generator exit code !RC!, delivery skipped - site keeps serving previous data>>"!LOG!"
  echo failed !DATE! !TIME! generator exit=!RC!>>"!FAIL!"
  exit /b 1
)

if not exist "!SRC!\guides.json" (
  echo [FAIL] !SRC!\guides.json not found after generation>>"!LOG!"
  echo failed !DATE! !TIME! missing guides.json>>"!FAIL!"
  exit /b 1
)

echo [COPY] xcopy "!SRC!" "!PUBDIR!\!SIX!\">>"!LOG!"
xcopy /E /I /Y /Q "!SRC!" "!PUBDIR!\!SIX!\" >>"!LOG!" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo [FAIL] xcopy exit code !RC!>>"!LOG!"
  echo failed !DATE! !TIME! xcopy exit=!RC!>>"!FAIL!"
  exit /b 1
)

echo [OK] delivered month !SIX! to !PUBDIR!\!SIX! - updater publishes within 5 min>>"!LOG!"
echo [OK] month !SIX! generated and delivered
exit /b 0
