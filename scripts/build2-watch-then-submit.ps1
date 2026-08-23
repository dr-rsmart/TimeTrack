# build2-watch-then-submit.ps1 — same as the first watcher but for build #2
$root = 'C:\Users\Ricardo Smart\Desktop\TimeTrack'
Set-Location $root
function Log($msg) { Add-Content "$root\eas-pipeline2.log" ("[$(Get-Date -Format 'HH:mm:ss')] " + $msg) }

Log 'Watcher2 started'
$buildPid = (Get-Content "$root\eas-build2.pid").Trim()
while (Get-Process -Id $buildPid -ErrorAction SilentlyContinue) { Start-Sleep 30 }
Log 'eas build #2 process exited'

$logText = Get-Content "$root\eas-build2-out.log" -Raw
if ($logText -match 'Build finished') {
  Log 'Build #2 succeeded — starting EAS submit'
  $submit = Start-Process cmd.exe -ArgumentList @('/c','eas','submit','--platform','ios','--id','76df4c22-f52c-408b-8fee-effc2dcdac75','--non-interactive','--verbose','--wait') -WorkingDirectory $root `
    -RedirectStandardOutput "$root\eas-submit3-out.log" -RedirectStandardError "$root\eas-submit3-err.log" -PassThru
  $submit.WaitForExit()
  Log ("eas submit #2 exit code: " + $submit.ExitCode)
  if ($submit.ExitCode -eq 0) {
    Log 'Submit #2 succeeded — running ASC add-for-review'
    & node "$root\scripts\add-for-review-asc.mjs" *> "$root\eas-review2-out.log"
    Log ("add-for-review exit code: " + $LASTEXITCODE)
    Log 'PIPELINE2 COMPLETE'
  } else {
    Log 'eas submit #2 FAILED — inspect eas-submit3-out.log'
  }
} else {
  Log 'Build #2 did NOT finish — inspect eas-build2-out.log'
}