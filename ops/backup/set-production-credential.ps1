# OWNER RUNS THIS (once, or after a password reset). Stores the production database password
# DPAPI-encrypted for this Windows user, after proving it connects. Nothing is echoed or logged.
#   powershell -ExecutionPolicy Bypass -File C:\Users\elish\CompetenBackup\bin\set-production-credential.ps1
. (Join-Path $PSScriptRoot 'competen-backup-common.ps1')
$p = $Profiles.production
"Production database password for $($p.User) (Supabase: Project Settings > Database)."
$sec = Read-Host -AsSecureString 'Password'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
try {
  Confirm-Docker
  $env:CB_CONN = "host=$($p.Host) port=5432 dbname=postgres user=$($p.User) sslmode=require"
  $o = Invoke-Docker @('run', '--rm', '-e', 'CB_CONN', '-e', 'PGPASSWORD', $DumpImage, 'psql', '-X', '-w', '-Atc', 'select 1', '-d', $env:CB_CONN)
  if ($script:DockerExit -ne 0 -or ($o | Select-Object -Last 1) -ne '1') { throw "connection test failed: $(($o | Select-Object -Last 1))" }
  New-Item -ItemType Directory -Force -Path $SecureDir | Out-Null
  $sec | ConvertFrom-SecureString | Set-Content -LiteralPath $p.CredFile -Encoding ascii
  Write-Log 'backup' 'production credential set (DPAPI) after a successful connection test'
  'Saved. Connection test passed. The 20:30 task will now back up production.'
} finally { Clear-SecretEnv }
