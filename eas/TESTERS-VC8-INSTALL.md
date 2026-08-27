# TimeTrack for Android — vc8 direct install (tester build)

This build contains the fix for the stuck **"Loading TimeTrack…"** splash screen
that some Android testers experienced. The web login page now always appears:
the native splash dismisses as soon as the page loads, and a 6-second failsafe
guarantees it can never cover the app again.

## Install link (share with testers)

https://expo.dev/artifacts/eas/9zymBRVXclahwl3Djmj_5Lwdiw-A_8uzCNMPvWsMwWE.apk

- Build: `63fe62a9-c62b-46ba-8e86-567ea4e6e103` (EAS, internal distribution)
- Version: `1.0.0` (**versionCode 8** — installs as an update over the Play build)
- Local copy in this repo: `timetrack-vc8-direct.apk`

## Tester instructions

1. On the Android device, open the link above (or receive the `.apk` file).
2. Tap **Install** (first time only: allow *Install unknown apps* for the
   browser/file manager when Android asks).
3. Open **TimeTrack**. The splash shows briefly, then the **login page**
   appears (within ~2 s on a normal connection, never more than ~6 s).
4. Sign in as usual and confirm clock-in/out, shifts and dashboard load.

## Notes

- The APK is signed with the same keystore as the Play Store build, so it
  upgrades cleanly and a later Play update (Release 8, currently in Google
  review) will still install on top of it.
- Once Google approves Release 8 on the Closed testing → Alpha track, testers
  can also update via the Play Store as normal.
- If anything still looks wrong, capture a screenshot plus
  *Settings → About phone → Android version* and report back.
