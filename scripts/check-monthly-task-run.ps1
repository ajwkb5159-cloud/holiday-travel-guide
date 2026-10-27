# Run a scheduled data task once and report its result. The task is idempotent:
# if the current month is already delivered and valid, it logs [SKIP] and exits 0.
# Must run elevated.
param(
  [string]$TaskName = 'HolidayGuideMonthlyDataGenCatchup',
  [int]$WaitSeconds = 60
)
$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }

$backupRoot = 'F:\HolidayGuide\backup'
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$logPath = Join-Path $backupRoot ('task-run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $logPath -Force | Out-Null

try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  Write-Host "[task] $TaskName state=$($task.State)"
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  do {
    Start-Sleep -Seconds 2
    $state = (Get-ScheduledTask -TaskName $TaskName).State
  } while ($state -eq 'Running' -and (Get-Date) -lt $deadline)

  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host ("[task] state={0} lastResult={1} lastRun={2} nextRun={3}" -f $state, $info.LastTaskResult, $info.LastRunTime, $info.NextRunTime)

  $month = Get-Date -Format 'yyyyMM'
  $batchLog = Join-Path $PSScriptRoot "..\.test-env\auto-gen-$month.log"
  if (Test-Path $batchLog) {
    Write-Host "`n--- tail $batchLog ---"
    Get-Content $batchLog -Tail 30 -Encoding UTF8
  } else {
    Write-Warning "batch log not found: $batchLog"
  }

  if ($info.LastTaskResult -ne 0) {
    Write-Error "task failed with $($info.LastTaskResult)"
    exit 1
  }
  Write-Host '[task] task run OK'
} finally {
  Write-Host "log: $logPath"
  Stop-Transcript | Out-Null
}
