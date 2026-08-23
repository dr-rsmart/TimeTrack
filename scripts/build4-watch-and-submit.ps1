# build4-watch-and-submit.ps1
$root = 'C:\Users\Ricardo Smart\Desktop\TimeTrack'
Set-Location $root
function Log($msg) { Add-Content "$root\eas-pipeline4.log" ("[$(Get-Date -Format 'HH:mm:ss')] " + $msg) }

Log 'Watcher4 started'
$buildPid = (Get-Content "$root\eas-build4.pid").Trim()
while (Get-Process -Id $buildPid -ErrorAction SilentlyContinue) { Start-Sleep 15 }
Log 'eas build #4 process exited'

$logText = Get-Content "$root\eas-build4-out.log" -Raw
if ($logText -match 'Build finished') {
  Log 'Build #4 succeeded — starting EAS submit'
  $submit = Start-Process cmd.exe -ArgumentList @('/c','eas','submit','--platform','ios','--id','e6ef4218-5b93-4708-aaf3-3103226786be','--non-interactive','--verbose','--wait') -WorkingDirectory $root `
    -RedirectStandardOutput "$root\eas-submit4-out.log" -RedirectStandardError "$root\eas-submit4-err.log" -PassThru
  $submit.WaitForExit()
  Log ("eas submit #4 exit code: " + $submit.ExitCode)
  if ($submit.ExitCode -eq 0) {
    Log 'Submit #4 succeeded — running ASC add-for-review'
    & node "$root\scripts\add-for-review-asc.mjs" *> "$root\eas-review4-out.log"
    Log ("add-for-review exit code: " + $LASTEXITCODE)
  }
} else {
  Log 'Build #4 failed'
}