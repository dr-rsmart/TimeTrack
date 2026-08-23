# asc-watchdog.ps1 — keeps rerunning the ASC add-for-review script until the
# build is registered, attached and submitted for review (max ~3.5h of retries).
$root = 'C:\Users\Ricardo Smart\Desktop\TimeTrack'
Set-Location $root
function Log($msg) { Add-Content "$root\eas-watchdog.log" ("[$(Get-Date -Format 'HH:mm:ss')] " + $msg) }

Log 'Watchdog started'
$attempts = 0
while ($attempts -lt 45) {
  $attempts++
  & node "$root\scripts\add-for-review-asc.mjs" *> "$root\eas-review-final.log"
  $code = $LASTEXITCODE
  $tail = (Get-Content "$root\eas-review-final.log" -ErrorAction SilentlyContinue | Select-Object -Last 1)
  Log ("attempt $attempts exit=$code tail='$tail'")
  if ($code -eq 0) { Log 'SUCCESS — app submitted for review'; break }
  if ($tail -match 'already "WAITING_FOR_REVIEW"|already "IN_REVIEW"|"READY_FOR_SALE"') { Log 'Already submitted'; break }
  Start-Sleep 120
}
Log 'Watchdog finished'