# ⛔ DO NOT USE — Quarantined native artifacts (reference only)

**These files are NOT consumed by any build.** They were hand-written early
prototypes that predate the current EAS/CNG (Continuous Native Generation)
workflow. The single source of truth for both native platforms is the root
**`app.json`** (`expo.ios.infoPlist`, `expo.android.permissions`, config
plugins). EAS builds generate the real `android/` and `ios/` projects from
`app.json` on Expo's servers; nothing in this folder is read by `eas build`,
`expo prebuild`, CI, or the deploy pipeline.

They were quarantined here (2026-09-16 deployment-readiness audit) because
both contain values that would cause **store rejection or runtime failure**
if ever copied into a bare workflow:

| File                            | Landmine                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AndroidManifest.reference.xml` | Declares `.services.GeofenceBackgroundService` and `.receivers.GeofenceBroadcastReceiver` — **classes that do not exist** in the Expo shell (BOOT_COMPLETED would crash); requests `BIND_DEVICE_ADMIN` (Google Play device-admin policy trigger). |
| `Info.reference.plist`          | `UIRequiredDeviceCapabilities` includes **`armv7`** (removed from iOS years ago — ITMS upload rejection class); `CFBundleVersion 1` conflicts with EAS remote versioning.                                                                         |

If you need to inspect or tweak native config, edit `app.json` (and the
`expo-location` / `expo-notifications` / `expo-build-properties` plugin
entries). Keep these files only as historical reference, or delete them.
