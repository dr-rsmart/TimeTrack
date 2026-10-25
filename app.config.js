import fs from 'node:fs';
import { withAppBuildGradle, withGradleProperties } from 'expo/config-plugins';

/**
 * Dynamic overlay on app.json — app.json stays the single source of truth.
 *
 * google-services.json (Firebase project `timetrack-workforce`, FCM push for
 * Android) is NOT committed: the repository is public and the secret scan flags
 * its Firebase API key. EAS Build receives it through the `GOOGLE_SERVICES_JSON`
 * file environment variable (visibility: secret, environment: production);
 * local builds use the git-ignored ./google-services.json when present.
 * Without either, Android cannot mint a push token (pushRegistration =
 * 'token-failed' in the native diagnostics).
 */
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ??
  (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);

/**
 * Enables full R8 bytecode optimization (`proguard-android-optimize.txt`) and
 * AGP optimized resource shrinking (`android.r8.optimizedResourceShrinking=true`)
 * so `BUNDLE-METADATA/com.android.tools/r8.json` reports:
 *   - isOptimizationsEnabled: true
 *   - resourceOptimization.isOptimizedShrinkingEnabled: true
 * for Google Play Android Vitals.
 */
function withAndroidR8Optimization(config) {
  config = withAppBuildGradle(config, (modConfig) => {
    if (typeof modConfig.modResults?.contents === 'string') {
      modConfig.modResults.contents = modConfig.modResults.contents.replace(
        /getDefaultProguardFile\(\s*["']proguard-android\.txt["']\s*\)/g,
        'getDefaultProguardFile("proguard-android-optimize.txt")',
      );
    }
    return modConfig;
  });

  config = withGradleProperties(config, (modConfig) => {
    const key = 'android.r8.optimizedResourceShrinking';
    modConfig.modResults = modConfig.modResults.filter(
      (item) => !(item.type === 'property' && item.key === key),
    );
    modConfig.modResults.push({
      type: 'property',
      key,
      value: 'true',
    });
    return modConfig;
  });

  return config;
}

export default ({ config }) =>
  withAndroidR8Optimization({
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  });
