# Switch the production AI assistant to OpenCode Go (or another OpenAI-compatible endpoint).
# Backs up appsettings.json, clears the legacy inline ApiKey, writes ApiKeyFile, restarts the service.
#
# Must run elevated. Never prints the key.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\configure-prod-ai.ps1
#   ... -SendReasoningContent -MaxTokens 4096 -TimeoutSeconds 180
param(
  [string]$ConfigPath = 'F:\HolidayGuide\publish\backend\appsettings.json',
  [string]$BackupRoot = 'F:\HolidayGuide\backup',
  [string]$BaseUrl = 'https://opencode.ai/zen/go/v1/chat/completions',
  [string]$Model = 'deepseek-v4.1-flash',
  [string]$ApiKeyFile = 'F:\HolidayGuide\secrets\opencode.key',
  [int]$MaxTokens = 3000,
  [int]$TimeoutSeconds = 120,
  [double]$Temperature = 0.7,
  [switch]$SendReasoningContent,
  [switch]$EnableQuota,
  [int]$HistoryMaxTurns = 500,
  [int]$HistoryMaxChars = 1500000,
  [int]$HistoryPerMessageChars = 50000,
  [string]$ExtraBodyJson = '',
  [string]$ServiceName = 'HolidayGuideBackend',
  [string]$HealthUrl = 'http://127.0.0.1:5099/health',
  [string]$AiStatusUrl = 'http://127.0.0.1:5099/api/ai/status'
)
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }
if (-not (Test-Path $ConfigPath)) { Write-Error "config not found: $ConfigPath"; exit 1 }
if (-not (Test-Path $ApiKeyFile)) { Write-Error "ApiKeyFile not found: $ApiKeyFile (run install-opencode-secret.ps1 first)"; exit 1 }

function Set-Prop($obj, $name, $value) {
  if ($null -eq $obj.PSObject.Properties[$name]) {
    $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value
  } else {
    $obj.$name = $value
  }
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $BackupRoot "configure-ai-$stamp.log"
Start-Transcript -Path $logPath -Force | Out-Null
$backup = Join-Path $BackupRoot "appsettings.backend.prod.json.bak-ai-$stamp"
Copy-Item $ConfigPath $backup -Force
Write-Host "[ai] backup -> $backup"

$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if (-not $cfg.Ai) { $cfg | Add-Member -NotePropertyName Ai -NotePropertyValue ([pscustomobject]@{}) }
Set-Prop $cfg.Ai 'Enabled' $true
Set-Prop $cfg.Ai 'BaseURL' $BaseUrl
Set-Prop $cfg.Ai 'ApiKey' ''
Set-Prop $cfg.Ai 'ApiKeyFile' $ApiKeyFile
Set-Prop $cfg.Ai 'Model' $Model
Set-Prop $cfg.Ai 'MaxTokens' $MaxTokens
Set-Prop $cfg.Ai 'Temperature' $Temperature
Set-Prop $cfg.Ai 'TimeoutSeconds' $TimeoutSeconds
Set-Prop $cfg.Ai 'SendReasoningContent' ([bool]$SendReasoningContent)
Set-Prop $cfg.Ai 'QuotaEnabled' ([bool]$EnableQuota)
Set-Prop $cfg.Ai 'HistoryMaxTurns' $HistoryMaxTurns
Set-Prop $cfg.Ai 'HistoryMaxChars' $HistoryMaxChars
Set-Prop $cfg.Ai 'HistoryPerMessageChars' $HistoryPerMessageChars
Set-Prop $cfg.Ai 'ExtraBodyJson' $ExtraBodyJson

$json = $cfg | ConvertTo-Json -Depth 30
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ConfigPath, $json, $utf8)
Write-Host "[ai] wrote $ConfigPath"
Write-Host "[ai] BaseURL=$BaseUrl Model=$Model ApiKeyFile=$ApiKeyFile MaxTokens=$MaxTokens SendReasoningContent=$([bool]$SendReasoningContent) QuotaEnabled=$([bool]$EnableQuota) HistoryMaxTurns=$HistoryMaxTurns HistoryMaxChars=$HistoryMaxChars"

function Wait-ServiceState($name, $target, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    Start-Sleep -Seconds 2
    $state = (Get-Service -Name $name).Status
  } while ($state -ne $target -and (Get-Date) -lt $deadline)
  return $state
}

Write-Host "[ai] stopping $ServiceName"
& sc.exe stop $ServiceName | Out-Null
$stopped = Wait-ServiceState $ServiceName 'Stopped' 45
if ($stopped -ne 'Stopped') { Write-Error "service did not stop (state=$stopped)"; exit 1 }

Write-Host "[ai] starting $ServiceName"
& sc.exe start $ServiceName | Out-Null
$running = Wait-ServiceState $ServiceName 'Running' 45
if ($running -ne 'Running') { Write-Error "service did not start (state=$running); backup=$backup"; exit 1 }

$healthy = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
Write-Host "[ai] health=$healthy"
if (-not $healthy) { Write-Error "health check failed; inspect logs. backup=$backup"; exit 1 }

try {
  $status = Invoke-RestMethod -Uri $AiStatusUrl -TimeoutSec 10
  $enabled = $status.Data.Enabled
  Write-Host "[ai] /api/ai/status Enabled=$enabled"
  if (-not $enabled) { Write-Warning 'AI is still disabled in the effective config' }
} catch {
  Write-Warning "AI status check failed: $($_.Exception.Message)"
}

Write-Host "[ai] log: $logPath"
Write-Host '[ai] done'
Stop-Transcript | Out-Null
