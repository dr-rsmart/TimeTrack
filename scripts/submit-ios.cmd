@echo off
cd /d "C:\Users\Ricardo Smart\Desktop\TimeTrack"
call eas submit --platform ios --id c3e521ce-e61e-400a-a328-97b6f1f0de20 --non-interactive --verbose --wait > eas-submit-out.log 2>&1
set SUBMIT_EXIT=%ERRORLEVEL%
echo [eas submit exit %SUBMIT_EXIT%] >> eas-submit-out.log
if "%SUBMIT_EXIT%"=="0" (
  echo Submit OK - starting ASC add-for-review >> eas-submit-out.log
  node scripts\add-for-review-asc.mjs > eas-review-out.log 2>&1
  echo [review exit %ERRORLEVEL%] >> eas-review-out.log
)