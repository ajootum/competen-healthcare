# Isolated restore test of a Competen backup (COMPETEN-OPS-001 R4).
#   competen-restore-test.ps1 -Profile production [-File <name.dump.gpg>] [-RecoveryKeyFile <path>] [-SkipLive]
# Restores into a throwaway Supabase Postgres container with NO network, on a scratch Docker
# volume. Never touches staging or production; the live source is read only for catalog counts.
# Evidence (counts and hashes only, no row content) goes to C:\Users\elish\CompetenBackup\restore-tests.
param(
  [ValidateSet('production', 'staging')] [string]$Profile = 'production',
  [string]$File,
  [string]$RecoveryKeyFile,
  [switch]$SkipLive
)
. (Join-Path $PSScriptRoot 'competen-backup-common.ps1')

$dir = Join-Path $DbRoot $Profile
if (-not $File) {
  $File = (Get-ChildItem -LiteralPath $dir -Filter '*.dump.gpg' | Sort-Object Name -Descending | Select-Object -First 1).Name
  if (-not $File) { throw "no backups in $dir" }
}
$id = 'cb-restore-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$evDir = Join-Path $Root "restore-tests\$id"
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$started = Get-Date
$facts = [ordered]@{ test = $id; profile = $Profile; archive = $File; started = $started.ToString('o'); isolation = 'docker --network none, scratch volume, removed after' }
$manifestPath = Join-Path $dir ($File -replace '\.dump\.gpg$', '.json')
if (Test-Path -LiteralPath $manifestPath) { $facts.archive_sha256 = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).sha256 }

function ConvertFrom-KeyValues($lines) {
  $h = [ordered]@{}
  foreach ($l in $lines) { foreach ($m in [regex]::Matches($l, '(\w+)=(\S+)')) { $h[$m.Groups[1].Value] = $m.Groups[2].Value } }
  $h
}

$ok = $false
try {
  Confirm-Docker
  $env:CB_KEY = if ($RecoveryKeyFile) { (Get-Content -LiteralPath $RecoveryKeyFile | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim() } else { Get-ArchiveKey }
  $env:CB_FILE = $File
  [void](Invoke-Docker @('volume', 'create', $id))

  # 1. Decrypt and count the archive's rows (no network).
  $p = Invoke-Docker @('run', '--rm', '--network', 'none', '-e', 'CB_KEY', '-e', 'CB_FILE', '-v', "${BinDir}:/cb:ro", '-v', "${dir}:/in:ro", '-v', "${id}:/vol", $DumpImage, 'bash', '/cb/restore-prep.sh')
  Remove-Item Env:CB_KEY -ErrorAction SilentlyContinue
  if ($script:DockerExit -ne 0) { throw "decrypt failed: $(($p | Select-Object -Last 2) -join ' | ')" }
  $a = ConvertFrom-KeyValues $p; $a.file = $File; $facts.archive = $a

  # 2. Restore into a fresh database on a network-less Supabase Postgres.
  $pw = [Convert]::ToBase64String((1..18 | ForEach-Object { [byte](Get-Random -Maximum 256) }))
  $env:POSTGRES_PASSWORD = $pw
  [void](Invoke-Docker @('run', '-d', '--name', $id, '--network', 'none', '-e', 'POSTGRES_PASSWORD', '-v', "${id}:/vol", '-v', "${BinDir}:/cb:ro", $RestoreImage))
  Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue
  if ($script:DockerExit -ne 0) { throw 'restore server did not start' }
  $r = Invoke-Docker @('exec', $id, 'bash', '/cb/restore-run.sh')
  if ($script:DockerExit -ne 0) { throw "restore failed: $(($r | Select-Object -Last 2) -join ' | ')" }
  $facts.restore = ConvertFrom-KeyValues $r
  [void](Invoke-Docker @('cp', "${id}:/vol/restore.log", (Join-Path $evDir 'pg_restore.log')))

  # 3. Every table's row count against the archive, plus schema facts.
  $v = Invoke-Docker @('exec', $id, 'bash', '/cb/restore-verify.sh')
  if ($script:DockerExit -ne 0) { throw "verification failed: $(($v | Select-Object -Last 2) -join ' | ')" }
  $v | Set-Content -LiteralPath (Join-Path $evDir 'verify.txt') -Encoding utf8
  $facts.restored = ConvertFrom-KeyValues $v

  # 4. Cross-check catalog facts against the live source (read-only; counts and hashes only).
  if (-not $SkipLive) {
    $conn = Get-ConnArgs $Profile
    $l = Invoke-Docker (@('run', '--rm', '-v', "${BinDir}:/cb:ro") + $conn + @($DumpImage, 'bash', '/cb/live-facts.sh'))
    if ($script:DockerExit -ne 0) { throw "live cross-check failed: $(($l | Select-Object -Last 2) -join ' | ')" }
    $facts.live = ConvertFrom-KeyValues $l
    $facts.live_matches = [ordered]@{}
    foreach ($k in $facts.live.Keys) { $facts.live_matches[$k] = ($facts.live[$k] -eq $facts.restored[$k]) }
  }

  $rs = $facts.restore; $rd = $facts.restored
  $ok = ($rs.restore_rc -eq '0') -and ($rs.restore_errors -eq '0') -and ($rd.mismatches -eq '0') -and ([int]$rd.checked -eq [int]$facts.archive.tables_with_data)
  if ($facts.Contains('live_matches')) { $ok = $ok -and -not ($facts.live_matches.Values -contains $false) }
} catch {
  $facts.error = $_.Exception.Message
} finally {
  Clear-SecretEnv; Remove-Item Env:CB_FILE, Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue
  [void](Invoke-Docker @('rm', '-f', $id))
  [void](Invoke-Docker @('volume', 'rm', $id))
  $facts.cleanup_containers_left = @(Invoke-Docker @('ps', '-a', '-q', '--filter', "name=$id")).Where({ $_ }).Count
  $facts.cleanup_volumes_left = @(Invoke-Docker @('volume', 'ls', '-q', '--filter', "name=$id")).Where({ $_ }).Count
  $facts.result = if ($ok) { 'PASS' } else { 'FAIL' }
  $facts.elapsed_seconds = [int]((Get-Date) - $started).TotalSeconds
  $facts | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evDir 'result.json') -Encoding utf8
  Write-Log 'restore-test' "[$Profile] $($facts.result) $File elapsed=$($facts.elapsed_seconds)s evidence=$evDir $($facts.error)"
}
$facts | ConvertTo-Json -Depth 4
if (-not $ok) { exit 1 }
