import fs from 'node:fs';

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

export default ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
});
