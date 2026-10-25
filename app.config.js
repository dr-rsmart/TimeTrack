import fs from 'node:fs';
import path from 'node:path';
import { withAppBuildGradle, withDangerousMod, withGradleProperties } from 'expo/config-plugins';

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

/**
 * Patches Expo's Android headless loader, foreground location service, and
 * JobScheduler queue during prebuild so that:
 * 1. `RNHeadlessAppLoader` keeps the singleton Bridgeless `ReactHost` alive
 *    across 30s background wakes instead of calling `reactHost.destroy()`,
 *    which previously corrupted the warm process and caused a micro-crash on
 *    the first Activity open.
 * 2. `LocationTaskService` enters foreground mode immediately inside
 *    `onStartCommand` (with `mParentContext` safely defaulted) so Android 8-15
 *    never throws `ForegroundServiceDidNotStartInTimeException`.
 * 3. `TaskManagerUtils` caps queued `PersistableBundle` items per job to 10 so
 *    Android's Binder parcel size limit is never exceeded (`BadParcelableException`).
 */
function withAndroidHeadlessAndServiceFixes(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const root = modConfig.modRequest.projectRoot;

      // 1. RNHeadlessAppLoader.kt
      const headlessPath = path.join(
        root,
        'node_modules/expo-modules-core/android/src/main/java/expo/modules/adapters/react/apploader/RNHeadlessAppLoader.kt',
      );
      if (fs.existsSync(headlessPath)) {
        let src = fs.readFileSync(headlessPath, 'utf8').replace(/\r\n/g, '\n');
        src = src.replace(
          'val reactHost = (context.applicationContext as ReactApplication).reactHost ?: throw IllegalStateException("Your application does not have a valid reactHost")\n          reactHost.addReactInstanceEventListener(',
          'val reactHost = (context.applicationContext as ReactApplication).reactHost ?: throw IllegalStateException("Your application does not have a valid reactHost")\n          val existingContext = reactHost.currentReactContext\n          if (existingContext != null) {\n            HeadlessAppLoaderNotifier.notifyAppLoaded(params.appScopeKey)\n            appRecords[params.appScopeKey] = existingContext\n            callback?.apply(true)\n            return\n          }\n          reactHost.addReactInstanceEventListener(',
        );
        src = src.replace(
          'if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {\n        // New architecture\n        val reactHost = (reactContext.applicationContext as ReactApplication).reactHost ?: throw IllegalStateException("Your application does not have a valid reactHost")\n        android.os.Handler(reactContext.mainLooper).post {\n          // Only destroy the `ReactInstanceManager` if it does not bind with an Activity.\n          // And The Activity would take over the ownership of `ReactInstanceManager`.\n          // This case happens when a user clicks a background task triggered notification immediately.\n          if (reactHost.lifecycleState == LifecycleState.BEFORE_CREATE) {\n            reactHost.destroy("Closing headless task app", null)\n          }\n          HeadlessAppLoaderNotifier.notifyAppDestroyed(appScopeKey)\n          appRecords.remove(appScopeKey)\n        }\n      }',
          'if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {\n        // Keep singleton Bridgeless ReactHost & headless TaskManager alive across 30s wakes\n        // so MainActivity first-open never races reactHost.destroy().\n        return false\n      }',
        );
        src = src.replace(
          "// New architecture - We can return true since the fact that we have a reactContext\n      // means that we've already called start on the reactHost\n      return true",
          'val reactHost = (reactContext.applicationContext as ReactApplication).reactHost ?: return false\n      return reactHost.lifecycleState != LifecycleState.RESUMED',
        );
        fs.writeFileSync(headlessPath, src, 'utf8');
      }

      // 2. LocationTaskConsumer.kt & LocationTaskService.kt
      const consumerPath = path.join(
        root,
        'node_modules/expo-location/android/src/main/java/expo/modules/location/taskConsumers/LocationTaskConsumer.kt',
      );
      if (fs.existsSync(consumerPath)) {
        let src = fs.readFileSync(consumerPath, 'utf8').replace(/\r\n/g, '\n');
        if (!src.includes('extras.putBundle("serviceOptions", serviceOptions)')) {
          src = src.replace(
            'extras.putBoolean("killService", serviceOptions.getBoolean("killServiceOnDestroy", false))\n      serviceIntent.putExtras(extras)',
            'extras.putBoolean("killService", serviceOptions.getBoolean("killServiceOnDestroy", false))\n      extras.putBundle("serviceOptions", serviceOptions)\n      serviceIntent.putExtras(extras)',
          );
          fs.writeFileSync(consumerPath, src, 'utf8');
        }
      }

      const servicePath = path.join(
        root,
        'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
      );
      if (fs.existsSync(servicePath)) {
        let src = fs.readFileSync(servicePath, 'utf8').replace(/\r\n/g, '\n');
        src = src.replace(
          'private lateinit var mParentContext: Context',
          'private var mParentContext: Context? = null',
        );
        src = src.replace(
          'mParentContext.packageManager.getLaunchIntentForPackage(mParentContext.packageName)',
          '(mParentContext ?: applicationContext).packageManager.getLaunchIntentForPackage((mParentContext ?: applicationContext).packageName)',
        );
        src = src.replace(
          'override fun onStartCommand(intent: Intent, flags: Int, startId: Int): Int {\n    val extras = intent.extras\n    if (extras != null) {\n      mChannelId = extras.getString("appId") + ":" + extras.getString("taskName")\n      mKillService = extras.getBoolean("killService", false)\n    }\n    return START_REDELIVER_INTENT\n  }',
          'override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {\n    val extras = intent?.extras\n    if (extras != null) {\n      mChannelId = extras.getString("appId") + ":" + extras.getString("taskName")\n      mKillService = extras.getBoolean("killService", false)\n      extras.getBundle("serviceOptions")?.let { startForeground(it) }\n    }\n    return START_STICKY\n  }',
        );
        fs.writeFileSync(servicePath, src, 'utf8');
      }

      // 3. TaskManagerUtils.java (cap queued PersistableBundle items to 10)
      const utilsPath = path.join(
        root,
        'node_modules/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskManagerUtils.java',
      );
      if (fs.existsSync(utilsPath)) {
        let src = fs.readFileSync(utilsPath, 'utf8').replace(/\r\n/g, '\n');
        src = src.replace(
          'private JobInfo createJobInfoByAddingData(JobInfo jobInfo, List<PersistableBundle> data) {\n    PersistableBundle mergedExtras = jobInfo.getExtras();\n    int dataSize = mergedExtras.getInt("dataSize", 0);\n\n    if (data != null) {\n      mergedExtras.putInt("dataSize", dataSize + data.size());\n\n      for (int i = 0; i < data.size(); i++) {\n        mergedExtras.putPersistableBundle(String.valueOf(dataSize + i), data.get(i));\n      }\n    }\n    return createJobInfo(jobInfo.getId(), jobInfo.getService(), mergedExtras);\n  }',
          'private JobInfo createJobInfoByAddingData(JobInfo jobInfo, List<PersistableBundle> data) {\n    PersistableBundle existing = jobInfo.getExtras();\n    PersistableBundle mergedExtras = new PersistableBundle();\n    mergedExtras.putString("appId", existing.getString("appId"));\n    mergedExtras.putString("taskName", existing.getString("taskName"));\n    mergedExtras.putBoolean(EXTRAS_REQUIRED_KEY, true);\n    List<PersistableBundle> combined = new ArrayList<>();\n    int dataSize = existing.getInt("dataSize", 0);\n    for (int i = 0; i < dataSize; i++) {\n      PersistableBundle item = existing.getPersistableBundle(String.valueOf(i));\n      if (item != null) combined.add(item);\n    }\n    if (data != null) combined.addAll(data);\n    int maxItems = 10;\n    if (combined.size() > maxItems) {\n      combined = combined.subList(combined.size() - maxItems, combined.size());\n    }\n    mergedExtras.putInt("dataSize", combined.size());\n    for (int i = 0; i < combined.size(); i++) {\n      mergedExtras.putPersistableBundle(String.valueOf(i), combined.get(i));\n    }\n    return createJobInfo(jobInfo.getId(), jobInfo.getService(), mergedExtras);\n  }',
        );
        fs.writeFileSync(utilsPath, src, 'utf8');
      }

      return modConfig;
    },
  ]);
}

export default ({ config }) =>
  withAndroidHeadlessAndServiceFixes(
    withAndroidR8Optimization({
      ...config,
      android: {
        ...config.android,
        ...(googleServicesFile ? { googleServicesFile } : {}),
      },
    }),
  );
