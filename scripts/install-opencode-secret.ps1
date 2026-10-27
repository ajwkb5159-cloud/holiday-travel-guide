# Copy the OpenCode Go API key from the user's pi auth.json into a service-readable
# file outside the publish tree, then lock it down with ACLs.
#
# Never prints the key. Must run elevated (for icacls on the secrets directory).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-opencode-secret.ps1
#   ... -Force   overwrite an existing key file (a .bak copy is kept)
param(
  [string]$AuthJson = (Join-Path $env:USERPROFILE '.pi\agent\auth.json'),
  [string]$OutFile = 'F:\HolidayGuide\secrets\opencode.key',
  [string]$Provider = 'opencode-go',
  [string]$KeyEnv = '',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error 'This script must run as administrator.'; exit 1 }

$key = ''
if ($KeyEnv) { $key = [Environment]::GetEnvironmentVariable($KeyEnv, 'Process') }
if ([string]::IsNullOrWhiteSpace($key)) {
  if (-not (Test-Path $AuthJson)) { Write-Error "auth json not found: $AuthJson (or pass -KeyEnv <NAME>)"; exit 1 }
  $auth = Get-Content $AuthJson -Raw | ConvertFrom-Json
  $entry = $auth.$Provider
  if (-not $entry) { Write-Error "provider '$Provider' not found in $AuthJson"; exit 1 }
  if ($entry.type -ne 'api_key') { Write-Error "provider '$Provider' is not api_key (type=$($entry.type)); OAuth tokens are not supported"; exit 1 }
  $key = [string]$entry.key
}
if ([string]::IsNullOrWhiteSpace($key)) { Write-Error 'resolved key is empty'; exit 1 }

$dir = Split-Path -Parent $OutFile
New-Item -ItemType Directory -Force -Path $dir | Out-Null

if ((Test-Path $OutFile) -and -not $Force) {
  Write-Error "key file already exists: $OutFile (use -Force to overwrite)"
  exit 1
}
if (Test-Path $OutFile) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item $OutFile "$OutFile.bak-$stamp" -Force
  Write-Host "[secret] existing key backed up to $OutFile.bak-$stamp"
}

# UTF-8 without BOM, no trailing newline
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $key, $utf8)

$current = "$env:USERDOMAIN\$env:USERNAME"
& icacls $OutFile /inheritance:r /grant:r '*S-1-5-18:(R)' '*S-1-5-32-544:(F)' "$current:(R)" | Out-Null
& icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(RX)' '*S-1-5-32-544:(OI)(CI)(F)' "$current:(OI)(CI)(RX)" | Out-Null

$key = [System.IO.File]::ReadAllText($OutFile)
$masked = if ($key.Length -ge 8) { $key.Substring(0, 4) + '...' + $key.Substring($key.Length - 4) } else { '(short)' }
Write-Host "[secret] wrote $OutFile length=$($key.Length) key=$masked"
Write-Host "[secret] ACL: SYSTEM read, Administrators full, $current read"
