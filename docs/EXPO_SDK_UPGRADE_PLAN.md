# Expo SDK Upgrade Plan — clears the remaining npm advisories (Open-07)

**Status:** PREPARED 2026-09-15. After `react-router-dom` was upgraded to
v7.18.4 (moderate advisory cleared), the remaining **14 moderate advisories**
all live in the Expo SDK 52 build chain (`@expo/cli`, `@expo/config*`,
`@expo/rudder-sdk-node`, `expo`, `expo-asset`, `expo-constants`,
`expo-notifications`, `expo-splash-screen`, `uuid@8`, `xcode`). None affect
the deployed web/server runtime; they are build/submission-toolchain and
mobile-runtime advisories with **no fix inside SDK 52** — the only supported
path is an SDK upgrade.

## Target

Expo SDK 52 → latest stable (54+): React Native 0.76 → 0.81+, React 18.3 →
19.x. This is a **major mobile regression surface** and must not be attempted
in the same window as a production web launch.

## Procedure (owner/engineering, ~1 day + regression pass)

```bash
# 1. Branch + baseline
git checkout -b chore/expo-sdk-upgrade
npm run test && npx playwright test   # green baseline

# 2. Upgrade SDK (official upgrade path)
npx expo install expo@^54 -- --fix    # aligns all expo-* modules
npx expo install --fix                # fix remaining version mismatches
npm audit --omit=dev                  # expect 0 moderate in the expo chain

# 3. Config/build verification
npx expo prebuild --clean             # regenerate native projects
eas build --profile preview --platform android   # smoke build
eas build --profile preview --platform ios

# 4. Mobile regression scope (all touch native modules)
#    - expo-location foreground + BACKGROUND task auto clock-in/out
#    - expo-task-manager background wake + pending-action queue
#    - expo-notifications push registration + delivery
#    - react-native-webview production web-app shell (cookie session)
#    - expo-splash-screen / status-bar visuals
#    - NetInfo offline banner

# 5. Store pipelines
npm run play:closedalpha && npm run play:verify   # Android closed alpha
npm run submit:ios                                # iOS TestFlight
```

## Rollback

The upgrade lives on its own branch; the mobile store artifacts (vc11 closed
alpha) are unaffected until a new build is submitted. Abandon = delete branch.

## Why not `npm audit fix --force` on SDK 52

It downgrades/breaks the pinned Expo module graph (`expo-notifications`
0.29.x, `expo-task-manager` 12.x are SDK-52-locked) and produces an
unbuildable mobile project while leaving `xcode`/`@expo/*` advisories
unfixed anyway (no patched versions exist in the SDK 52 range).
