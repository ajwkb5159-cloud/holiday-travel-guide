# Run run-monthly-data.bat --probe as SYSTEM in a temporary scheduled task,
# then print the result and remove the task.
#
# This verifies the exact service-account context (key paths, node.exe, publish dir)
# without calling any LLM or generating data.
#
# Must run elevated. The temporary task is removed in a finally block.
param(
  [string]$TaskName = 'HolidayGuideMonthlyProbe',
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }

$backupRoot = 'F:\HolidayGuide\backup'
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$logPath = Join-Path $backupRoot ('probe-monthly-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $logPath -Force | Out-Null

$bat = Join-Path $PSScriptRoot 'run-monthly-data.bat'
if (-not (Test-Path $bat)) { Write-Error "batch not found: $bat"; exit 1 }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`" --probe" -WorkingDirectory $PSScriptRoot
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "[probe] temporary task registered: $TaskName"
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 2
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    $state = (Get-ScheduledTask -TaskName $TaskName).State
  } while ($state -eq 'Running' -and (Get-Date) -lt $deadline)

  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host ("[probe] state={0} lastResult={1} lastRun={2}" -f $state, $info.LastTaskResult, $info.LastRunTime)

  $month = Get-Date -Format 'yyyyMM'
  $log = Join-Path $PSScriptRoot "..\.test-env\auto-gen-$month.log"
  if (Test-Path $log) {
    Write-Host "`n--- tail $log ---"
    Get-Content $log -Tail 40
  } else {
    Write-Warning "log not found: $log"
  }

  if ($info.LastTaskResult -ne 0) { exit 1 }
} finally {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "[probe] temporary task removed: $TaskName"
  Write-Host "log: $logPath"
  Stop-Transcript | Out-Null
}
