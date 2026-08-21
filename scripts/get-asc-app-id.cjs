/**
 * Resolves the App Store Connect numeric App ID (ascAppId) for
 * bundle id com.timetrack.workforce using the ASC API key in asc-api-key.json.
 */
const fs = require('fs');
const path = require('path');

const EAS_CLI = 'C:/Users/Ricardo Smart/AppData/Roaming/npm/node_modules/eas-cli';
const { Token } = require(path.join(EAS_CLI, 'node_modules/@expo/apple-utils/build/index.js'));

async function main() {
  const keyFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'asc-api-key.json'), 'utf-8'));
  const token = await Token.sign({
    key: keyFile.key_p8,
    issuerId: keyFile.issuer_id,
    keyId: keyFile.key_id,
    duration: 600,
  });

  const res = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=200', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`ASC API error ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const app = (body.data || []).find((a) => a.attributes?.bundleId === 'com.timetrack.workforce');
  if (!app) {
    console.error('App not found in App Store Connect. Apps:', JSON.stringify((body.data || []).map((a) => a.attributes?.bundleId)));
    process.exit(1);
  }
  console.log('ASC_APP_ID=' + app.id);
  console.log('NAME=' + app.attributes.name);
}

main().catch((err) => {
  console.error('FAILED:', err?.message || err);
  process.exit(1);
});