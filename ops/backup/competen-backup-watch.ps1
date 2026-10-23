# Missed-schedule and failure watch for the Competen backups (COMPETEN-OPS-001).
# Runs at logon and at midday; raises one Windows notification listing every problem found.
. (Join-Path $PSScriptRoot 'competen-backup-common.ps1')

$problems = @()
$now = Get-Date

$st = Read-Status 'production'
if (-not $st) { $problems += 'Production database backup has never run.' }
else {
  if ($st.result -ne 'ok') { $problems += "Last production backup FAILED: $($st.error)" }
  if (-not $st.last_success) { $problems += 'No successful production backup yet.' }
  elseif (($now - [datetime]$st.last_success).TotalHours -gt 26) { $problems += "Production backup missed: last good one $(([datetime]$st.last_success).ToString('ddd dd MMM HH:mm'))." }
  if (-not $st.last_ssd_copy -or ($now - [datetime]$st.last_ssd_copy).TotalDays -gt 7) { $problems += 'No off-PC copy for over 7 days: connect the backup SSD (I:).' }
}

# Project files (robocopy to the SSD) run under the existing daily task.
$t = Get-ScheduledTask -TaskName 'ADLERC daily backup' -ErrorAction SilentlyContinue
if ($t) {
  $i = $t | Get-ScheduledTaskInfo
  if ($i.LastTaskResult -ne 0) { $problems += "Project-files backup did not complete on $($i.LastRunTime.ToString('ddd dd MMM')) (result $($i.LastTaskResult); SSD connected?)." }
  if (($now - $i.LastRunTime).TotalHours -gt 26) { $problems += 'Project-files backup has not run in over a day.' }
} else { $problems += 'Project-files backup task is missing.' }

if ($problems.Count) {
  Write-Log 'watch' ('PROBLEMS: ' + ($problems -join ' / '))
  Show-Alert 'Competen backups need attention' ($problems -join "`n")
} else { Write-Log 'watch' 'all backups current' }
$problems
