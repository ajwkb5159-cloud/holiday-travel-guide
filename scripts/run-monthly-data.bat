@echo off
rem =====================================================================
rem  Holiday Travel Guide - monthly data generation and delivery
rem ---------------------------------------------------------------------
rem  Usage : run-monthly-data.bat [--force] [--fresh] [--probe] [--preflight-only]
rem    (no args)        : generate current month, skip when already delivered
rem    --force          : regenerate even if current month already delivered
rem    --fresh          : move existing partial/ aside before generation
rem    --probe          : environment/key/path checks only, no LLM call
rem    --preflight-only : environment checks + one real LLM smoke, no delivery
rem  Local config: scripts\monthly-data.local.bat (gitignored) sets
rem    KEYDIR / PUBDIR / PRIMARY_PROVIDER / FALLBACK_PROVIDER / OPENCODE_KEY_FILE /
rem    NODE_EXE / BASELINE / ALLOW_REUSE / PUBLISH_WWWROOT / REFRESH_IMAGES / FACTS
rem  Log   : <repo>\.test-env\auto-gen-<yyyyMM>.log
rem          markers: auto-gen-<yyyyMM>.FAILED / .SUCCESS
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
if not defined BASELINE set "BASELINE=auto"
if not defined REFRESH_IMAGES set "REFRESH_IMAGES=1"
if not defined FACTS set "FACTS=1"
set "HOLIDAY_GUIDE_KEY_DIR=%KEYDIR%"

set "FORCE=0"
set "FRESH=0"
set "PROBE=0"
set "PREFLIGHT_ONLY=0"
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--force" set "FORCE=1"
if /i "%~1"=="--fresh" set "FRESH=1"
if /i "%~1"=="--probe" set "PROBE=1"
if /i "%~1"=="--preflight-only" set "PREFLIGHT_ONLY=1"
shift
goto parse_args
:args_done

rem ---------- resolve Node (SYSTEM may not have the same PATH) ----------
set "NODE=!NODE_EXE!"
if not defined NODE for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"

rem ---------- current month (yyyyMM) ----------
rem 不要用 for /f 嵌套带空格的 node.exe 路径（会被截成 C:\Program）；PowerShell 更稳。
set "SIX="
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMM')"') do set "SIX=%%i"
if "!SIX!"=="" (
  echo [ERROR] cannot resolve current month
  exit /b 2
)

set "LOGDIR=%ROOT%\.test-env"
if not exist "!LOGDIR!" mkdir "!LOGDIR!"
set "LOG=!LOGDIR!\auto-gen-!SIX!.log"
set "FAIL=!LOGDIR!\auto-gen-!SIX!.FAILED"
set "SUCCESS=!LOGDIR!\auto-gen-!SIX!.SUCCESS"
set "SRC=%ROOT%\HolidayGuideUpdater\data\!SIX!"
set "PARTIAL=!SRC!\partial"

set "WHO="
for /f "delims=" %%i in ('whoami 2^>nul') do set "WHO=%%i"

echo.>>"!LOG!"
echo ================ !DATE! !TIME! run-monthly-data month=!SIX! force=!FORCE! fresh=!FRESH! probe=!PROBE! ================>>"!LOG!"
echo [INFO] whoami=!WHO!>>"!LOG!"
echo [INFO] node=!NODE!>>"!LOG!"
echo [INFO] keyDir=!KEYDIR! publishDir=!PUBDIR!>>"!LOG!"
echo [INFO] provider=!PRIMARY_PROVIDER! fallback=!FALLBACK_PROVIDER! baseline=!BASELINE!>>"!LOG!"
echo [INFO] refreshImages=!REFRESH_IMAGES! facts=!FACTS! publishWwwroot=!PUBLISH_WWWROOT!>>"!LOG!"

if not defined NODE (
  echo [FAIL] node.exe not found; set NODE_EXE in monthly-data.local.bat>>"!LOG!"
  echo failed !DATE! !TIME! node missing>>"!FAIL!"
  exit /b 2
)

if not exist "%ROOT%\scripts\node_modules\lunar-javascript" (
  echo [FAIL] scripts\node_modules\lunar-javascript missing; run: npm ci --prefix scripts>>"!LOG!"
  echo failed !DATE! !TIME! lunar-javascript missing>>"!FAIL!"
  exit /b 2
)

if not exist "!PUBDIR!" mkdir "!PUBDIR!" 2>nul
echo.>"!PUBDIR!\.write-test-!SIX!" 2>nul
if not exist "!PUBDIR!\.write-test-!SIX!" (
  echo [FAIL] publish dir not writable: !PUBDIR!>>"!LOG!"
  echo failed !DATE! !TIME! publish dir not writable>>"!FAIL!"
  exit /b 2
)
del "!PUBDIR!\.write-test-!SIX!" >nul 2>&1

rem ---------- primary key probe (fast fail) ----------
echo [PROBE] primary channel key check>>"!LOG!"
"!NODE!" "%ROOT%\scripts\gen-real.mjs" --probe-keys --require-primary --key-dir "!KEYDIR!" --provider !PRIMARY_PROVIDER! --fallback-provider !FALLBACK_PROVIDER! >>"!LOG!" 2>&1
if not "!ERRORLEVEL!"=="0" (
  echo [FAIL] primary provider !PRIMARY_PROVIDER! has no readable key under !KEYDIR!>>"!LOG!"
  echo [FAIL] check OpenCode key file / provider key / env vars under !KEYDIR!>>"!LOG!"
  echo failed !DATE! !TIME! key probe failed>>"!FAIL!"
  exit /b 1
)

if "!PROBE!"=="1" (
  if defined PUBLISH_WWWROOT (
    if not exist "!PUBLISH_WWWROOT!\images" mkdir "!PUBLISH_WWWROOT!\images" 2>nul
    echo.>"!PUBLISH_WWWROOT!\images\.write-test-!SIX!" 2>nul
    if not exist "!PUBLISH_WWWROOT!\images\.write-test-!SIX!" (
      echo [FAIL] publish wwwroot images not writable: !PUBLISH_WWWROOT!\images>>"!LOG!"
      echo failed !DATE! !TIME! wwwroot not writable>>"!FAIL!"
      exit /b 2
    )
    del "!PUBLISH_WWWROOT!\images\.write-test-!SIX!" >nul 2>&1
  )
  echo [PROBE] OK whoami=!WHO! node=!NODE! month=!SIX! keyDir=!KEYDIR!>>"!LOG!"
  echo [PROBE] OK
  exit /b 0
)

rem ---------- idempotency: validate delivered file before skipping ----------
if "!FORCE!"=="0" if exist "!PUBDIR!\!SIX!\guides.json" (
  "!NODE!" "%ROOT%\scripts\validate-month.mjs" --month !SIX! --file "!PUBDIR!\!SIX!\guides.json" --quiet >>"!LOG!" 2>&1
  if "!ERRORLEVEL!"=="0" (
    echo [SKIP] !PUBDIR!\!SIX!\guides.json valid, nothing to do>>"!LOG!"
    echo [SKIP] month !SIX! already delivered
    exit /b 0
  )
  echo [WARN] delivered !SIX! guides.json is invalid; regenerating>>"!LOG!"
)

if exist "!FAIL!" del "!FAIL!" >nul 2>&1

rem ---------- public facts + images (non-blocking) ----------
if "!FACTS!"=="1" if "!PREFLIGHT_ONLY!"=="0" (
  echo [FACTS] refresh public facts>>"!LOG!"
  "!NODE!" "%ROOT%\scripts\refresh-facts.mjs" --month !SIX! >>"!LOG!" 2>&1
  if not "!ERRORLEVEL!"=="0" echo [WARN] refresh-facts failed, generation will use cached/empty facts>>"!LOG!"
)

if "!REFRESH_IMAGES!"=="1" if "!PREFLIGHT_ONLY!"=="0" (
  echo [IMAGES] refresh Wikimedia Commons covers>>"!LOG!"
  if defined PUBLISH_WWWROOT (
    "!NODE!" "%ROOT%\scripts\refresh-images.mjs" --month !SIX! --sync-prod --prod-wwwroot "!PUBLISH_WWWROOT!\images" >>"!LOG!" 2>&1
  ) else (
    "!NODE!" "%ROOT%\scripts\refresh-images.mjs" --month !SIX! >>"!LOG!" 2>&1
  )
  if not "!ERRORLEVEL!"=="0" echo [WARN] refresh-images failed, old covers kept>>"!LOG!"
)

rem ---------- smoke preflight (real LLM, primary only) ----------
echo [SMOKE] primary channel !PRIMARY_PROVIDER! preflight - no fallback, single piece>>"!LOG!"
"!NODE!" "%ROOT%\scripts\gen-real.mjs" --month !SIX! --smoke beijing-zhongqiu --provider !PRIMARY_PROVIDER! --no-fallback --key-dir "!KEYDIR!" >>"!LOG!" 2>&1
if not "!ERRORLEVEL!"=="0" (
  echo [FAIL] primary channel !PRIMARY_PROVIDER! preflight failed>>"!LOG!"
  echo [FAIL] delivery skipped on purpose: fallback channels are lower quality, do not publish them automatically.>>"!LOG!"
  echo failed !DATE! !TIME! smoke preflight failed>>"!FAIL!"
  exit /b 1
)

if "!PREFLIGHT_ONLY!"=="1" (
  echo [PREFLIGHT] OK smoke passed; no delivery
  echo [PREFLIGHT] OK smoke passed; no delivery>>"!LOG!"
  exit /b 0
)

rem ---------- full generation ----------
set "FRESH_ARG="
set "BASELINE_ARG="
set "ALLOW_REUSE_ARG="
set "FACTS_ARG="
if "!FRESH!"=="1" set "FRESH_ARG=--fresh"
if defined BASELINE set "BASELINE_ARG=--baseline !BASELINE!"
if defined ALLOW_REUSE set "ALLOW_REUSE_ARG=--allow-reuse !ALLOW_REUSE!"
if "!FACTS!"=="0" set "FACTS_ARG=--facts none"

echo [GEN] full run with fallback chain>>"!LOG!"
"!NODE!" "%ROOT%\scripts\gen-real.mjs" --month !SIX! --provider !PRIMARY_PROVIDER! --fallback-provider !FALLBACK_PROVIDER! --concurrency 3 --key-dir "!KEYDIR!" !FRESH_ARG! !BASELINE_ARG! !ALLOW_REUSE_ARG! !FACTS_ARG! >>"!LOG!" 2>&1
if not "!ERRORLEVEL!"=="0" (
  echo [FAIL] generator failed, delivery skipped - site keeps serving previous data>>"!LOG!"
  echo failed !DATE! !TIME! generator failed>>"!FAIL!"
  exit /b 1
)

if not exist "!SRC!\guides.json" (
  echo [FAIL] !SRC!\guides.json not found after generation>>"!LOG!"
  echo failed !DATE! !TIME! missing guides.json>>"!FAIL!"
  exit /b 1
)

echo [VALIDATE] source guides.json>>"!LOG!"
"!NODE!" "%ROOT%\scripts\validate-month.mjs" --month !SIX! --require-version --quiet >>"!LOG!" 2>&1
if not "!ERRORLEVEL!"=="0" (
  echo [FAIL] source guides.json failed validation>>"!LOG!"
  echo failed !DATE! !TIME! source validation failed>>"!FAIL!"
  exit /b 1
)

rem ---------- deliver (robocopy exit codes <8 are success) ----------
echo [COPY] robocopy "!SRC!" "!PUBDIR!\!SIX!\">>"!LOG!"
robocopy "!SRC!" "!PUBDIR!\!SIX!" /E /XD partial /XF failed.jsonl /NFL /NDL /NJH /NJS /NP >>"!LOG!" 2>&1
set "RC=!ERRORLEVEL!"
if !RC! GEQ 8 (
  echo [FAIL] robocopy exit code !RC!>>"!LOG!"
  echo failed !DATE! !TIME! robocopy exit=!RC!>>"!FAIL!"
  exit /b 1
)

echo [VALIDATE] delivered guides.json>>"!LOG!"
"!NODE!" "%ROOT%\scripts\validate-month.mjs" --month !SIX! --file "!PUBDIR!\!SIX!\guides.json" --require-version --quiet >>"!LOG!" 2>&1
if not "!ERRORLEVEL!"=="0" (
  echo [FAIL] delivered guides.json failed validation>>"!LOG!"
  echo failed !DATE! !TIME! delivered validation failed>>"!FAIL!"
  exit /b 1
)

if exist "!FAIL!" del "!FAIL!" >nul 2>&1
echo ok !DATE! !TIME! month=!SIX!> "!SUCCESS!"
echo [OK] delivered month !SIX! to !PUBDIR!\!SIX! - updater publishes within 5 min>>"!LOG!"
echo [OK] month !SIX! generated and delivered
exit /b 0
