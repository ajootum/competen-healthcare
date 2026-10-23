# Shared settings and helpers for the Competen database backup scripts (COMPETEN-OPS-001).
# Secrets never appear here. The production password and the archive key are DPAPI-encrypted
# (current Windows user only) in $Root\secure, which only the owner's account can read. It sits
# outside AppData, which the Claude desktop app virtualises for processes it starts.

$ErrorActionPreference = 'Stop'

$Root      = 'C:\Users\elish\CompetenBackup'
$DbRoot    = Join-Path $Root 'db'
$LogDir    = Join-Path $Root 'logs'
$SecureDir = Join-Path $Root 'secure'
$KeyFile   = Join-Path $SecureDir 'archive-key.dpapi'
$SsdRoot   = 'I:\Backups\competen-db'
$DumpImage    = 'postgres:17'
$RestoreImage = 'public.ecr.aws/supabase/postgres:17.6.1.167'

$Profiles = @{
  # Credential set by the owner with set-production-credential.ps1.
  production = @{ Host = 'aws-0-eu-west-1.pooler.supabase.com'; User = 'postgres.rnnqhlrcgvsauigxwszl'; Auth = 'dpapi'
                  CredFile = (Join-Path $SecureDir 'production-db.dpapi') }
  # Rehearsal only: reads STAGING_DB_URL from the main checkout's .env.local at run time.
  staging    = @{ Host = 'aws-1-eu-west-1.pooler.supabase.com'; User = 'postgres.ezhvpgtcqcdsgylrxgdb'; Auth = 'envfile'
                  EnvFile = 'C:\Users\elish\Documents\Competen\competen-healthcare\.env.local'; EnvVar = 'STAGING_DB_URL' }
}

New-Item -ItemType Directory -Force -Path $DbRoot, $LogDir | Out-Null

function Write-Log([string]$Name, [string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath (Join-Path $LogDir "$Name.log") -Value $line -Encoding utf8
}

function Show-Alert([string]$Title, [string]$Body) {
  # Windows toast; falls back silently (the log and status file remain the record).
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $esc = { param($s) [Security.SecurityElement]::Escape($s) }
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast scenario='reminder'><visual><binding template='ToastGeneric'><text>$(& $esc $Title)</text><text>$(& $esc $Body)</text></binding></visual><actions><action content='Dismiss' arguments='dismiss' activationType='system'/></actions></toast>")
    $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
  } catch { }
}

function Get-StatusPath([string]$ProfileName) { Join-Path $DbRoot "$ProfileName\status.json" }

function Read-Status([string]$ProfileName) {
  $p = Get-StatusPath $ProfileName
  if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } else { $null }
}

function Get-ArchiveKey {
  # Returns the archive passphrase; creates a random one on first use. Never logged or printed.
  if (-not (Test-Path -LiteralPath $KeyFile)) {
    if (Get-ChildItem -LiteralPath $DbRoot -Recurse -Filter '*.dump.gpg' -ErrorAction SilentlyContinue | Select-Object -First 1) {
      throw "archive key missing but encrypted backups exist: restore $KeyFile from the recovery copy (I:\Backups\competen-db\RECOVERY-KEY.txt)"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $KeyFile) | Out-Null
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $plain = [Convert]::ToBase64String($bytes)
    ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $KeyFile -Encoding ascii
    Write-Log 'backup' 'archive key created (DPAPI, current user); export a recovery copy with competen-db-backup.ps1 -ExportRecoveryKey'
  }
  Read-DpapiFile $KeyFile
}

function Read-DpapiFile([string]$Path) {
  $sec = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-EnvFileValue([string]$Path, [string]$Name) {
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if (-not $line) { throw "$Name not found in $Path" }
  ($line -replace "^$Name=", '').Trim().Trim('"')
}

# Runs docker with stderr folded into the output as text (Windows PowerShell 5.1 would
# otherwise turn native stderr into terminating errors). Exit code in $script:DockerExit.
function Invoke-Docker([string[]]$DockerArgs) {
  $ErrorActionPreference = 'Continue'
  $o = @(& docker @DockerArgs 2>&1 | ForEach-Object { "$_" })
  $script:DockerExit = $LASTEXITCODE
  return ,$o
}

function Confirm-Docker {
  [void](Invoke-Docker @('info', '--format', '{{.ServerVersion}}'))
  if ($script:DockerExit -eq 0) { return }
  $exe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe | Out-Null }
  for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    [void](Invoke-Docker @('info', '--format', '{{.ServerVersion}}'))
    if ($script:DockerExit -eq 0) { return }
  }
  throw 'Docker is not running and did not start within 3 minutes'
}

$BinDir = $PSScriptRoot

# Docker arguments that give the container a database connection without putting the
# password on any command line: values travel as environment variables passed by name only.
function Get-ConnArgs([string]$ProfileName) {
  $p = $Profiles[$ProfileName]
  if ($p.Auth -eq 'dpapi') {
    if (-not (Test-Path -LiteralPath $p.CredFile)) { throw "production credential not set: run set-production-credential.ps1" }
    $env:CB_CONN = "host=$($p.Host) port=5432 dbname=postgres user=$($p.User) sslmode=require"
    $env:PGPASSWORD = Read-DpapiFile $p.CredFile
    return @('-e', 'CB_CONN', '-e', 'PGPASSWORD')
  }
  $env:CB_CONN = Get-EnvFileValue $p.EnvFile $p.EnvVar
  return @('-e', 'CB_CONN')
}

function Clear-SecretEnv { Remove-Item Env:CB_CONN, Env:CB_KEY, Env:PGPASSWORD -ErrorAction SilentlyContinue }

# Keep the newest backup of each of the 7 most recent days that have one, plus the newest of
# each of the 4 most recent ISO weeks that have one. A long outage never empties the folder.
function Invoke-Retention([string]$Dir) {
  $files = @(Get-ChildItem -LiteralPath $Dir -Filter '*.dump.gpg' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '-(\d{8})-(\d{4})\.dump\.gpg$' } |
    ForEach-Object { $d = [datetime]::ParseExact($Matches[1] + $Matches[2], 'yyyyMMddHHmm', $null)
      [pscustomobject]@{ File = $_; Stamp = $d; Day = $d.ToString('yyyy-MM-dd')
        Week = '{0}-W{1:00}' -f $d.Year, [Globalization.CultureInfo]::InvariantCulture.Calendar.GetWeekOfYear($d, 'FirstFourDayWeek', 'Monday') } } |
    Sort-Object Stamp -Descending)
  $keep = @{}
  $files | Group-Object Day  | Select-Object -First 7 | ForEach-Object { $keep[$_.Group[0].File.FullName] = 1 }
  $files | Group-Object Week | Select-Object -First 4 | ForEach-Object { $keep[$_.Group[0].File.FullName] = 1 }
  foreach ($f in $files) {
    if (-not $keep.ContainsKey($f.File.FullName)) {
      Remove-Item -LiteralPath $f.File.FullName -Force
      Remove-Item -LiteralPath ($f.File.FullName -replace '\.dump\.gpg$', '.json') -Force -ErrorAction SilentlyContinue
    }
  }
  return $keep.Count
}
