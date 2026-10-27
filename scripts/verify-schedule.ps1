# Verify (and optionally register) the two monthly data-generation scheduled tasks.
# Must run elevated.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-schedule.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-schedule.ps1 -RegisterIfMissing
param(
  [switch]$RegisterIfMissing
)
$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }

$backupRoot = 'F:\HolidayGuide\backup'
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$logPath = Join-Path $backupRoot ('verify-schedule-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $logPath -Force | Out-Null

$names = @('HolidayGuideMonthlyDataGen', 'HolidayGuideMonthlyDataGenCatchup')
$missing = @()
foreach ($name in $names) {
  Write-Host "`n=== $name ==="
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Host 'NOT FOUND'
    $missing += $name
    continue
  }
  $task | Select-Object TaskName, State, @{n='RunAs';e={$_.Principal.UserId}}, @{n='RunLevel';e={$_.Principal.RunLevel}} | Format-List
  foreach ($action in $task.Actions) {
    Write-Host ("Action: {0} {1}" -f $action.Execute, $action.Arguments)
  }
  foreach ($trigger in $task.Triggers) {
    Write-Host ("Trigger: {0} StartBoundary={1}" -f $trigger.CimClass.CimClassName, $trigger.StartBoundary)
  }
  $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue
  if ($info) {
    Write-Host ("LastRunTime={0} LastTaskResult={1} NextRunTime={2}" -f $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
  }
}

if ($missing.Count -gt 0) {
  if (-not $RegisterIfMissing) {
    Write-Host "`nMissing tasks: $($missing -join ', ')"
    Write-Host 'Re-run with -RegisterIfMissing to register them, or run scripts\install-monthly-task.bat as administrator.'
    Write-Host "log: $logPath"
    Stop-Transcript | Out-Null
    exit 2
  }
  $installer = Join-Path $PSScriptRoot 'install-monthly-task.bat'
  if (-not (Test-Path $installer)) { Write-Error "installer not found: $installer"; exit 1 }
  Write-Host "`nRegistering missing tasks via $installer"
  & cmd.exe /c "`"$installer`""
  if ($LASTEXITCODE -ne 0) { Write-Error "installer failed: $LASTEXITCODE"; exit 1 }
}

Write-Host "`n[OK] scheduled task verification complete."
Write-Host "log: $logPath"
Stop-Transcript | Out-Null
