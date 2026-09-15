# ios18-pipeline.ps1
# ------------------
# End-to-end iOS release pipeline for build 19:
#   1. Wait for EAS build f2d91d51 (buildNumber 18) to FINISH
#   2. eas submit --platform ios --latest  (upload IPA to App Store Connect)
#   3. Poll ASC until build 19 is VALID (guards against the silent-drop that
#      happened with build 17)
#   4. node scripts/add-for-review-asc.mjs (attach build + submit for review)
# Runs detached; logs to %TEMP%\ios18-pipeline.log
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot\..
$buildId = '3ecd1b29-a680-4df9-b07a-ec0daf75d8d1'

function Log($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) }

# ── Step 1: wait for build to finish ──
Log "Step 1: waiting for EAS build $buildId to finish..."
$deadline = (Get-Date).AddMinutes(60)
$artifact = $null
while ((Get-Date) -lt $deadline) {
  $raw = Get-Content "$env:TEMP\eas-build-ios19.log" -Raw -ErrorAction SilentlyContinue
  if ($raw -match 'Build finished') {
    if ($raw -match 'Artifact:\s*(https://\S+)') { $artifact = $Matches[1] }
    Log "Build FINISHED. Artifact: $artifact"
    break
  }
  if ($raw -match 'Build failed| errored') { Log 'BUILD FAILED — aborting pipeline.'; exit 1 }
  Start-Sleep 30
}
if (-not $artifact -and -not ((Get-Content "$env:TEMP\eas-build-ios19.log" -Raw) -match 'Build finished')) {
  Log 'Timed out waiting for build — aborting.'; exit 1
}

# ── Step 2: upload to App Store Connect ──
Log 'Step 2: eas submit --platform ios --latest ...'
$env:EAS_BUILD_NO_EXPO_GO_WARNING = 'true'
cmd /c "npx eas-cli submit --platform ios --latest --non-interactive > `"$env:TEMP\eas-ios-submit19.log`" 2>&1"
$sub = Get-Content "$env:TEMP\eas-ios-submit19.log" -Raw
if ($sub -notmatch 'Submitted your app') { Log 'EAS submit did not report success — check eas-ios-submit19.log. Aborting.'; exit 1 }
Log 'EAS reports binary uploaded.'

# ── Step 3: verify build 19 actually lands in ASC and becomes VALID ──
Log 'Step 3: waiting for ASC to show build 19 VALID (max 45 min)...'
$deadline = (Get-Date).AddMinutes(45)
$valid = $false
while ((Get-Date) -lt $deadline) {
  $out = node -e @"
const fs=require('fs'),crypto=require('crypto');
const k=JSON.parse(fs.readFileSync('asc-api-key.json','utf8'));
const b64=(i)=>Buffer.from(i).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const now=Math.floor(Date.now()/1000);
const p=b64(JSON.stringify({alg:'ES256',kid:k.key_id,typ:'JWT'}))+'.'+b64(JSON.stringify({iss:k.issuer_id,iat:now,exp:now+600,aud:'appstoreconnect-v1'}));
const sig=crypto.createSign('SHA256').update(p).sign({key:k.key_p8,dsaEncoding:'ieee-p1363'});
const t=p+'.'+b64(sig);
(async()=>{
  const r=await fetch('https://api.appstoreconnect.apple.com/v1/builds?filter[app]=6803827296&filter[version]=19&limit=2',{headers:{Authorization:'Bearer '+t}});
  const j=await r.json();
  const b=(j.data||[])[0];
  if(!b){console.log('NOT_FOUND');return;}
  console.log(b.attributes.processingState);
})().catch(()=>console.log('ERR'));
"@
  Log "ASC build 19 state: $out"
  if ($out -match 'VALID') { $valid = $true; break }
  if ($out -match 'INVALID|FAILED') { Log 'Apple marked build 19 INVALID — check the Invalid Binary email. Aborting.'; exit 1 }
  Start-Sleep 45
}
if (-not $valid) { Log 'build 19 never appeared in ASC (silent drop again). Aborting — do NOT submit build 11.'; exit 1 }

# ── Step 4: attach + submit for review ──
Log 'Step 4: attaching build 19 and submitting for App Review...'
node scripts\add-for-review-asc.mjs
Log "add-for-review exit code: $LASTEXITCODE"
Log 'PIPELINE COMPLETE.'

