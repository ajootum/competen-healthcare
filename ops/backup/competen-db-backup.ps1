# Daily encrypted logical backup of a Competen database (COMPETEN-OPS-001).
#   competen-db-backup.ps1 -Profile production        scheduled daily
#   competen-db-backup.ps1 -ExportRecoveryKey          copy the archive key to the BitLocker SSD
# Dump and encryption happen inside one container: the plaintext dump never touches the host disk.
param(
  [ValidateSet('production', 'staging')] [string]$Profile = 'production',
  [switch]$ExportRecoveryKey
)
. (Join-Path $PSScriptRoot 'competen-backup-common.ps1')

if ($ExportRecoveryKey) {
  if (-not (Test-Path -LiteralPath 'I:\Backups')) { throw 'Backup SSD (I:) not connected' }
  New-Item -ItemType Directory -Force -Path $SsdRoot | Out-Null
  $dest = Join-Path $SsdRoot 'RECOVERY-KEY.txt'
  @('Competen database backup archive key (gpg symmetric AES-256). Keep a second copy in the owner''s password manager.',
    'Restore: competen-restore-test.ps1 -RecoveryKeyFile <this file>', '', (Get-ArchiveKey)) | Set-Content -LiteralPath $dest -Encoding ascii
  Write-Log 'backup' "recovery key exported to $dest"
  'Recovery key written to ' + $dest
  return
}

$dir = Join-Path $DbRoot $Profile
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$name = "competen-$Profile-$stamp"
$tmp = Join-Path $dir "$name.dump.gpg.tmp"
$started = Get-Date
$status = [ordered]@{ profile = $Profile; last_attempt = $started.ToString('o') }
$prev = Read-Status $Profile
foreach ($k in 'last_success', 'last_file', 'last_public_data_entries') { if ($prev -and $prev.$k) { $status[$k] = $prev.$k } }

try {
  Write-Log 'backup' "[$Profile] start"
  Confirm-Docker
  $conn = Get-ConnArgs $Profile
  $env:CB_KEY = Get-ArchiveKey

  $env:CB_NAME = $name
  $common = @('run', '--rm', '-e', 'CB_KEY', '-e', 'CB_NAME', '-v', "${BinDir}:/cb:ro")
  $out = Invoke-Docker ($common + $conn + @('-v', "${dir}:/out", $DumpImage, 'bash', '/cb/dump.sh'))
  if ($script:DockerExit -ne 0) { throw "dump failed: $(($out | Select-Object -Last 3) -join ' | ')" }
  $serverVersion = ($out | Select-Object -Last 1).Trim()

  # Integrity: decrypt (gpg checks the MDC) and read the whole archive's table of contents.
  $v = Invoke-Docker ($common + @('--shm-size', '2g', '-v', "${dir}:/out:ro", $DumpImage, 'bash', '/cb/verify.sh'))
  if ($script:DockerExit -ne 0) { throw "verification failed: $(($v | Select-Object -Last 3) -join ' | ')" }
  $sha, $tocEntries, $publicData, $publicPolicies = $v | Select-Object -Last 4 | ForEach-Object { $_.Trim() }
  $tocEntries = [int]$tocEntries; $publicData = [int]$publicData; $publicPolicies = [int]$publicPolicies
  if ($publicData -le 0) { throw 'verification failed: no public table data in the archive' }
  if ($prev -and $prev.last_public_data_entries -and $publicData -lt [math]::Floor(0.9 * [int]$prev.last_public_data_entries)) {
    throw "verification failed: public table-data entries fell from $($prev.last_public_data_entries) to $publicData"
  }

  $final = Join-Path $dir "$name.dump.gpg"
  Move-Item -LiteralPath $tmp -Destination $final
  $size = (Get-Item -LiteralPath $final).Length
  $manifest = [ordered]@{ file = "$name.dump.gpg"; profile = $Profile; created = $started.ToString('o'); seconds = [int]((Get-Date) - $started).TotalSeconds
    bytes = $size; sha256 = $sha; server_version = $serverVersion; toc_entries = $tocEntries; public_table_data = $publicData; public_policies = $publicPolicies
    encryption = 'gpg symmetric AES-256 (key: DPAPI, current user)'; verified = 'gpg MDC + full pg_restore --list' }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dir "$name.json") -Encoding utf8
  $kept = Invoke-Retention $dir

  # Off-PC copy when the BitLocker SSD is connected (add, then the same retention there).
  $ssd = 'not connected'
  if (Test-Path -LiteralPath 'I:\Backups') {
    $sd = Join-Path $SsdRoot $Profile
    New-Item -ItemType Directory -Force -Path $sd | Out-Null
    Copy-Item -LiteralPath $final, (Join-Path $dir "$name.json") -Destination $sd -Force
    $copied = Get-Item -LiteralPath (Join-Path $sd "$name.dump.gpg")
    if ($copied.Length -ne $size) { throw 'SSD copy size mismatch' }
    [void](Invoke-Retention $sd)
    $ssd = 'copied'
    $status.last_ssd_copy = (Get-Date).ToString('o')
  } elseif ($prev -and $prev.last_ssd_copy) { $status.last_ssd_copy = $prev.last_ssd_copy }

  $status.result = 'ok'; $status.last_success = (Get-Date).ToString('o'); $status.last_file = "$name.dump.gpg"
  $status.last_public_data_entries = $publicData; $status.kept = $kept; $status.ssd = $ssd
  Write-Log 'backup' "[$Profile] OK $name.dump.gpg bytes=$size toc=$tocEntries public_data=$publicData policies=$publicPolicies pg=$serverVersion kept=$kept ssd=$ssd secs=$($manifest.seconds)"
} catch {
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  $status.result = 'failed'; $status.error = $_.Exception.Message
  Write-Log 'backup' "[$Profile] FAILED $($_.Exception.Message) (previous good backups kept)"
  Show-Alert "Competen $Profile backup FAILED" $_.Exception.Message
} finally {
  Clear-SecretEnv; Remove-Item Env:CB_NAME -ErrorAction SilentlyContinue
  if ($prev -and $prev.last_ssd_copy -and -not $status.Contains('last_ssd_copy')) { $status.last_ssd_copy = $prev.last_ssd_copy }
  $status | ConvertTo-Json | Set-Content -LiteralPath (Get-StatusPath $Profile) -Encoding utf8
}
if ($status.result -ne 'ok') { exit 1 }
