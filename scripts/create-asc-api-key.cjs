/**
 * Creates an App Store Connect API Key non-interactively by reusing the
 * cached Apple session cookie (restored from ~/.app-store/auth/<email>/cookie)
 * via eas-cli's bundled authentication + ASC API key utilities.
 *
 * Output: writes ./asc-api-key.json in the format accepted by
 * `eas submit --asc-api-json-path`.
 */
const fs = require('fs');
const path = require('path');

const EAS_CLI = 'C:/Users/Ricardo Smart/AppData/Roaming/npm/node_modules/eas-cli';
const { authenticateAsync } = require(path.join(EAS_CLI, 'build/credentials/ios/appstore/authenticate.js'));
const { createAscApiKeyAsync } = require(path.join(EAS_CLI, 'build/credentials/ios/appstore/ascApiKey.js'));

async function main() {
  // Authenticate as user (session cookie restore; EXPO_APPLE_ID must be set)
  const authCtx = await authenticateAsync({});

  const analyticsStub = { logEvent: () => {} };
  const key = await createAscApiKeyAsync(analyticsStub, authCtx, {});

  const out = {
    key_id: key.keyId,
    issuer_id: key.issuerId,
    key_p8: key.keyP8,
  };

  const outPath = path.resolve(process.cwd(), 'asc-api-key.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('ASC API KEY CREATED');
  console.log('keyId:', key.keyId);
  console.log('issuerId:', key.issuerId);
  console.log('teamId:', key.teamId);
  console.log('written to:', outPath);
}

main().catch((err) => {
  console.error('FAILED:', err?.message || err);
  process.exit(1);
});
