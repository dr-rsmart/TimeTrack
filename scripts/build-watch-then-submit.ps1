# build-watch-then-submit.ps1
# Detached pipeline watcher: waits for the running `eas build` CLI process to
# exit, verifies the build succeeded, then chains `eas submit` (App Store
# Connect upload via API key) and finally the ASC add-for-review script.
# All diagnostics are appended to eas-pipeline.log.

$root = 'C:\Users\Ricardo Smart\Desktop\TimeTrack'
Set-Location $root

function Log($msg) { Add-Content "$root\eas-pipeline.log" ("[$(Get-Date -Format 'HH:mm:ss')] " + $msg) }

Log 'Watcher started'
$buildPid = (Get-Content "$root\eas-build.pid").Trim()

# 1) Wait for the eas build CLI process to exit
while (Get-Process -Id $buildPid -ErrorAction SilentlyContinue) { Start-Sleep 30 }
Log 'eas build process exited'

$logText = Get-Content "$root\eas-build-out.log" -Raw
if ($logText -match 'Build finished') {
  Log 'Build succeeded — starting EAS submit'
  $submitArgs = @(
    '/c', 'eas', 'submit',
    '--platform', 'ios',
    '--id', 'c3e521ce-e61e-400a-a328-97b6f1f0de20',
    '--non-interactive', '--verbose', '--wait',
    '--what-to-test', 'Demo admin login: admin@timetrack.com / Password123'
  )
  $submit = Start-Process cmd.exe -ArgumentList $submitArgs -WorkingDirectory $root `
    -RedirectStandardOutput "$root\eas-submit-out.log" -RedirectStandardError "$root\eas-submit-err.log" -PassThru
  $submit.WaitForExit()
  Log ("eas submit exit code: " + $submit.ExitCode)

  if ($submit.ExitCode -eq 0) {
    Log 'Submit succeeded — running ASC add-for-review (waits for Apple processing, attaches build, submits)'
    & node "$root\scripts\add-for-review-asc.mjs" *> "$root\eas-review-out.log"
    Log ("add-for-review exit code: " + $LASTEXITCODE)
    Log 'PIPELINE COMPLETE'
  } else {
    Log 'eas submit FAILED — inspect eas-submit-out.log / eas-submit-err.log'
  }
} else {
  Log 'Build did NOT finish successfully — skipping submit. Inspect eas-build-out.log'
}