# Production deploy (elevated): mirror a stage folder into the publish root and restart services.
#
# Usage (administrator PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-prod-elevated.ps1 `
#     -Stage C:\temp\hg-stage `
#     -PublishRoot <publish-root> `
#     -BackupRoot <backup-root>
#
# Safety rules:
#   1) /XF appsettings.json — the production config may contain secrets (AI key, update token).
#      Never let a mirror overwrite it.
#   2) /XD Data / data / logs + /XF state.json — runtime data must survive a deploy.
#   3) Backups are written outside the publish root, so the next mirror cannot delete them.
param(
  [Parameter(Mandatory = $true)][string]$Stage,
  [Parameter(Mandatory = $true)][string]$PublishRoot,
  [Parameter(Mandatory = $true)][string]$BackupRoot,
  [string]$StatusUrl = 'http://127.0.0.1:5099/api/system/status',
  [string]$BackendService = 'HolidayGuideBackend',
  [string]$UpdaterService = 'HolidayGuideUpdater',
  [switch]$SkipBackend,
  [switch]$SkipUpdater,
  [switch]$RequireAiKey
)
$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }
if (-not (Test-Path $Stage)) { Write-Error "Stage not found: $Stage"; exit 1 }
New-Item -ItemType Directory -Force -Path $PublishRoot | Out-Null

$log = Join-Path $PublishRoot 'deploy-prod.log'
function L($m) { ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $m) | Out-File $log -Append -Encoding utf8 }

L "=== deploy start (stage=$Stage publish=$PublishRoot) ==="
if (-not $SkipBackend -and -not (Test-Path (Join-Path $Stage 'backend'))) { L "stage backend missing: $(Join-Path $Stage 'backend')"; exit 1 }

if (-not $SkipBackend) { sc.exe stop $BackendService | Out-Null }
if (-not $SkipUpdater) { sc.exe stop $UpdaterService | Out-Null }
Start-Sleep -Seconds 12

# Services are stopped: take a consistent SQLite snapshot (db + wal + shm) before touching binaries.
$dbDir = Join-Path $PublishRoot 'backend\Data'
if (-not $SkipBackend -and (Test-Path (Join-Path $dbDir 'holiday.db'))) {
  $dbBackup = Join-Path $BackupRoot ('holiday.db.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $dbBackup | Out-Null
  foreach ($name in @('holiday.db', 'holiday.db-wal', 'holiday.db-shm')) {
    $src = Join-Path $dbDir $name
    if (Test-Path $src) { Copy-Item $src (Join-Path $dbBackup $name) -Force }
  }
  L ("db backup -> " + $dbBackup)
}

if (-not $SkipBackend) {
  robocopy (Join-Path $Stage 'backend') (Join-Path $PublishRoot 'backend') /MIR /XD Data /XF appsettings.json appsettings.Development.json /NFL /NDL /NJH /NJS /NP | Out-Null
  L ('backend robocopy exit ' + $LASTEXITCODE)
  robocopy (Join-Path $Stage 'backend\wwwroot') (Join-Path $PublishRoot 'backend\wwwroot') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  L ('wwwroot robocopy exit ' + $LASTEXITCODE)
}
if (-not $SkipUpdater) {
  robocopy (Join-Path $Stage 'updater') (Join-Path $PublishRoot 'updater') /MIR /XD data logs /XF state.json appsettings.json appsettings.Development.json /NFL /NDL /NJH /NJS /NP | Out-Null
  L ('updater robocopy exit ' + $LASTEXITCODE)
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$backendCfg = Join-Path $PublishRoot 'backend\appsettings.json'
$updaterCfg = Join-Path $PublishRoot 'updater\appsettings.json'
if (Test-Path $backendCfg) { Copy-Item $backendCfg (Join-Path $BackupRoot 'appsettings.backend.prod.json') -Force }
if (Test-Path $updaterCfg) { Copy-Item $updaterCfg (Join-Path $BackupRoot 'appsettings.updater.prod.json') -Force }

$aiKeyConfigured = $false
$aiKeySource = ''
if (Test-Path $backendCfg) {
  $prodCfg = Get-Content $backendCfg -Raw | ConvertFrom-Json
  if ($prodCfg.Ai -and $prodCfg.Ai.ApiKey) {
    $aiKeyConfigured = $true
    $aiKeySource = 'inline ApiKey'
  } elseif ($prodCfg.Ai -and $prodCfg.Ai.ApiKeyFile -and (Test-Path ([string]$prodCfg.Ai.ApiKeyFile))) {
    $aiKeyConfigured = $true
    $aiKeySource = [string]$prodCfg.Ai.ApiKeyFile
  }
}
L ("prod Ai key configured = " + $aiKeyConfigured + " source = " + $aiKeySource)
if ($RequireAiKey -and -not $aiKeyConfigured) { L 'ERROR: prod Ai key is not configured (RequireAiKey)' }

if (-not $SkipBackend) {
  sc.exe start $BackendService | Out-Null
  Start-Sleep -Seconds 10
}
if (-not $SkipUpdater) { sc.exe start $UpdaterService | Out-Null }
Start-Sleep -Seconds 3

try {
  $r = Invoke-WebRequest -Uri $StatusUrl -UseBasicParsing -TimeoutSec 20
  L ('status after deploy: HTTP ' + $r.StatusCode)
} catch { L ('status check failed: ' + $_.Exception.Message) }

if ($RequireAiKey -and -not $aiKeyConfigured) { L '=== deploy finished WITH ERRORS ==='; exit 1 }
L '=== deploy done ==='
