# Rotate the Update token in the production backend + updater configs (elevated).
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rotate-update-token.ps1 `
#     -PublishRoot <publish-root> -BackupRoot <backup-root>
#
# Safety:
#   - stops both services first;
#   - backs up both appsettings before writing;
#   - never prints token values;
#   - on failure restores the backups and restarts both services.
param(
  [Parameter(Mandatory = $true)][string]$PublishRoot,
  [Parameter(Mandatory = $true)][string]$BackupRoot,
  [string]$BackendService = 'HolidayGuideBackend',
  [string]$UpdaterService = 'HolidayGuideUpdater',
  [string]$HealthUrl = 'http://127.0.0.1:5099/health',
  [string]$UpdateStatusUrl = 'http://127.0.0.1:5099/api/update/status'
)
$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }

$backendCfg = Join-Path $PublishRoot 'backend\appsettings.json'
$updaterCfg = Join-Path $PublishRoot 'updater\appsettings.json'
if (-not (Test-Path $backendCfg) -or -not (Test-Path $updaterCfg)) {
  Write-Error "appsettings not found under $PublishRoot"
  exit 1
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $BackupRoot "rotate-token-$stamp.log"
function L($m) { $line = '[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m; $line | Out-File $log -Append -Encoding utf8; Write-Output $line }
function SvcState($name) { (sc.exe query $name | Select-String 'STATE').ToString().Trim() }
function WaitStopped($name) { for ($i = 0; $i -lt 30; $i++) { if ((SvcState $name) -match 'STOPPED') { return $true }; Start-Sleep -Seconds 1 }; return $false }
function WaitHealth() { for ($i = 0; $i -lt 40; $i++) { try { $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { return $true } } catch {}; Start-Sleep -Seconds 1 }; return $false }
function HttpStatus($url, $headers) {
  try { $r = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 10; return [int]$r.StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }; return -1 }
}
function WriteJsonNoBom($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
}

L '=== rotate update token ==='
$backend = Get-Content $backendCfg -Raw | ConvertFrom-Json
$updater = Get-Content $updaterCfg -Raw | ConvertFrom-Json
$oldToken = $backend.Update.Token
if (-not $oldToken) { L 'ERROR old token missing'; exit 1 }

$backendBackup = Join-Path $BackupRoot "appsettings.backend.prod.json.$stamp"
$updaterBackup = Join-Path $BackupRoot "appsettings.updater.prod.json.$stamp"
Copy-Item $backendCfg $backendBackup -Force
Copy-Item $updaterCfg $updaterBackup -Force

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$newToken = -join ($bytes | ForEach-Object { $_.ToString('x2') })

sc.exe stop $UpdaterService | Out-Null
sc.exe stop $BackendService | Out-Null
[void](WaitStopped $UpdaterService)
[void](WaitStopped $BackendService)

try {
  $backend.Update.Token = $newToken
  $updater.Backend.UpdateToken = $newToken
  WriteJsonNoBom $backendCfg $backend
  WriteJsonNoBom $updaterCfg $updater
  L 'configs updated (values not logged)'

  sc.exe start $BackendService | Out-Null
  if (-not (WaitHealth)) { throw 'backend health check failed' }
  $newStatus = HttpStatus $UpdateStatusUrl @{ 'X-Update-Token' = $newToken }
  $oldStatus = HttpStatus $UpdateStatusUrl @{ 'X-Update-Token' = $oldToken }
  $anonStatus = HttpStatus ($HealthUrl -replace '/health$', '/api/system/status') @{}
  L ('token check: new=' + $newStatus + ' old=' + $oldStatus + ' anonymous=' + $anonStatus)
  if ($newStatus -ne 200 -or $oldStatus -ne 401 -or $anonStatus -ne 200) { throw 'token verification failed' }

  sc.exe start $UpdaterService | Out-Null
  L 'updater service started'
  L '=== ROTATE_TOKEN_OK ==='
  exit 0
}
catch {
  L ('ERROR ' + $_.Exception.Message)
  L 'restoring backups and restarting services'
  Copy-Item $backendBackup $backendCfg -Force
  Copy-Item $updaterBackup $updaterCfg -Force
  sc.exe start $BackendService | Out-Null
  Start-Sleep -Seconds 5
  sc.exe start $UpdaterService | Out-Null
  L '=== ROTATE_TOKEN_FAILED (rolled back) ==='
  exit 1
}
