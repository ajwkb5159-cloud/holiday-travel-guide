# Publish one month's guides.json to production with a consistent backup and verification.
# Must run elevated.
#
# Sequence:
#   1) validate source guides.json (requires ?v=yyyyMM + credits)
#   2) stop Backend + Updater
#   3) back up SQLite (db/wal/shm), appsettings, state.json, wwwroot images, old updater month
#   4) start Backend
#   5) copy guides.json (+ facts.json) into publish\updater\data\<month>
#   6) run HolidayGuideUpdater.exe --run-once --month <month> with the Updater service stopped
#   7) start Updater and verify /api/system/status
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-month-elevated.ps1 -Month 202610
param(
  [string]$Month = '202610',
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$PublishRoot = 'F:\HolidayGuide\publish',
  [string]$BackupRoot = 'F:\HolidayGuide\backup',
  [string]$BackendService = 'HolidayGuideBackend',
  [string]$UpdaterService = 'HolidayGuideUpdater',
  [string]$StatusUrl = 'http://127.0.0.1:5099/api/system/status',
  [switch]$SkipPrecheck
)
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $BackupRoot "publish-$Month-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$logPath = Join-Path $backupDir 'publish.log'
function L($m) { $line = '[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m; Write-Host $line; Add-Content -Path $logPath -Value $line -Encoding utf8 }

$sourceGuides = Join-Path $RepoRoot "HolidayGuideUpdater\data\$Month\guides.json"
$sourceFacts = Join-Path $RepoRoot "HolidayGuideUpdater\data\$Month\facts.json"
if (-not (Test-Path $sourceGuides)) { Write-Error "source guides not found: $sourceGuides"; exit 1 }

# ---------- precheck ----------
if (-not $SkipPrecheck) {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
  if (-not (Test-Path $node)) { Write-Error 'node.exe not found'; exit 1 }
  $validator = Join-Path $RepoRoot 'scripts\validate-month.mjs'
  L "precheck: $node $validator --month $Month --require-version --strict-credits"
  & $node $validator --month $Month --require-version --strict-credits
  if ($LASTEXITCODE -ne 0) { Write-Error "precheck failed (exit $LASTEXITCODE); production untouched"; exit 1 }
}

# ---------- backup + stop ----------
function Stop-Svc($name) {
  $svc = Get-Service -Name $name -ErrorAction Stop
  if ($svc.Status -ne 'Stopped') {
    L "stopping $name"
    Stop-Service -Name $name -Force
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
  }
  L "$name = $((Get-Service -Name $name).Status)"
}
function Start-Svc($name) {
  $svc = Get-Service -Name $name -ErrorAction Stop
  if ($svc.Status -ne 'Running') {
    L "starting $name"
    Start-Service -Name $name
    $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
  }
  L "$name = $((Get-Service -Name $name).Status)"
}

try {
  try {
    $st = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 10
    if ($st.Data.IsUpdating) { Write-Error 'backend is currently updating; abort'; exit 1 }
  } catch { L "status precheck skipped: $($_.Exception.Message)" }

  Stop-Svc $UpdaterService
  Stop-Svc $BackendService

  $dbDir = Join-Path $PublishRoot 'backend\Data'
  $dbBackup = Join-Path $backupDir 'db'
  New-Item -ItemType Directory -Force -Path $dbBackup | Out-Null
  foreach ($name in @('holiday.db', 'holiday.db-wal', 'holiday.db-shm')) {
    $src = Join-Path $dbDir $name
    if (Test-Path $src) { Copy-Item $src (Join-Path $dbBackup $name) -Force }
  }
  L "db backup -> $dbBackup"

  $cfgBackup = Join-Path $backupDir 'config'
  New-Item -ItemType Directory -Force -Path $cfgBackup | Out-Null
  foreach ($pair in @(
    @{ src = (Join-Path $PublishRoot 'backend\appsettings.json'); dst = 'appsettings.backend.json' },
    @{ src = (Join-Path $PublishRoot 'updater\appsettings.json'); dst = 'appsettings.updater.json' },
    @{ src = (Join-Path $PublishRoot 'updater\state.json'); dst = 'state.json' }
  )) {
    if (Test-Path $pair.src) { Copy-Item $pair.src (Join-Path $cfgBackup $pair.dst) -Force }
  }
  L "config backup -> $cfgBackup"

  $wwwrootImages = Join-Path $PublishRoot 'backend\wwwroot\images'
  if (Test-Path $wwwrootImages) {
    Copy-Item $wwwrootImages (Join-Path $backupDir 'wwwroot-images') -Recurse -Force
    L "wwwroot images backup -> $backupDir\wwwroot-images"
  }

  $oldMonth = Join-Path $PublishRoot "updater\data\$Month"
  if (Test-Path $oldMonth) {
    Copy-Item $oldMonth (Join-Path $backupDir "updater-data-$Month") -Recurse -Force
    L "updater month backup -> $backupDir\updater-data-$Month"
  }

  Start-Svc $BackendService
  $healthUrl = $StatusUrl -replace '/api/system/status$', '/health'
  $healthy = $false
  for ($i = 0; $i -lt 30; $i++) {
    try { $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { $healthy = $true; break } } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $healthy) { throw "backend health check failed: $healthUrl" }

  $destDir = Join-Path $PublishRoot "updater\data\$Month"
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item $sourceGuides (Join-Path $destDir 'guides.json') -Force
  if (Test-Path $sourceFacts) { Copy-Item $sourceFacts (Join-Path $destDir 'facts.json') -Force }
  L "copied guides.json -> $destDir"

  $exe = Join-Path $PublishRoot 'updater\HolidayGuideUpdater.exe'
  if (-not (Test-Path $exe)) { throw "updater exe not found: $exe" }
  $updaterLog = Join-Path $backupDir 'updater-run.log'
  L "running: $exe --run-once --month $Month"
  Push-Location (Join-Path $PublishRoot 'updater')
  try {
    & $exe --run-once --month $Month 2>&1 | Tee-Object -FilePath $updaterLog
    $updaterRc = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($updaterRc -ne 0) { throw "updater --run-once failed (exit $updaterRc); see $updaterLog" }

  Start-Svc $UpdaterService

  $st = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 15
  L ("status: LastMonthKey={0} GuideCount={1} HolidayCount={2} IsUpdating={3} IsStale={4}" -f $st.Data.LastMonthKey, $st.Data.GuideCount, $st.Data.HolidayCount, $st.Data.IsUpdating, $st.Data.IsStale)
  if ($st.Data.LastMonthKey -ne $Month) { throw "LastMonthKey=$($st.Data.LastMonthKey), expected $Month" }
  if ($st.Data.GuideCount -ne 120) { throw "GuideCount=$($st.Data.GuideCount), expected 120" }
  if ($st.Data.HolidayCount -ne 10) { throw "HolidayCount=$($st.Data.HolidayCount), expected 10" }
  if ($st.Data.IsUpdating) { throw 'backend still reports IsUpdating=true' }

  L "publish done"
  Write-Host "`n[OK] published $Month; backup=$backupDir"
} catch {
  L "ERROR: $($_.Exception.Message)"
  try { Start-Svc $BackendService } catch { L "failed to start backend: $($_.Exception.Message)" }
  try { Start-Svc $UpdaterService } catch { L "failed to start updater: $($_.Exception.Message)" }
  Write-Error "publish failed; backup=$backupDir; see $logPath"
  exit 1
}
