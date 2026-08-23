/**
 * add-for-review-asc.mjs
 * ----------------------
 * Attaches the latest VALID App Store Connect build to the TimeTrack
 * App Store version and submits it to Apple for review — fully
 * non-interactively, using the App Store Connect API key
 * (asc-api-key.json: key_id / issuer_id / key_p8).
 *
 * Usage:  node scripts/add-for-review-asc.mjs
 *         npm run review:ios
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NUMERIC_ID = '6803827296'; // ASC Apple ID from eas.json
const API_BASE = 'https://api.appstoreconnect.apple.com/v1';

const KEY_FILE = path.join(__dirname, '..', 'asc-api-key.json');
if (!fs.existsSync(KEY_FILE)) {
  console.error('❌ asc-api-key.json not found at project root.');
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
const KEY_ID = key.key_id;
const ISSUER_ID = key.issuer_id;
const PEM = key.key_p8;

// ── ASC JWT auth (ES256) ──────────────────────────────────────────────
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: ISSUER_ID, iat: now, exp: now + 10 * 60, aud: 'appstoreconnect-v1' };
  const payload = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = crypto
    .createSign('SHA256')
    .update(payload)
    .sign({ key: PEM, dsaEncoding: 'ieee-p1363' });
  return `${payload}.${b64url(sig)}`;
}

let token = signJwt();
let tokenAt = Date.now();

async function api(resourcePath, method = 'GET', body) {
  if (Date.now() - tokenAt > 8 * 60 * 1000) {
    token = signJwt();
    tokenAt = Date.now();
  }
  const res = await fetch(API_BASE + resourcePath, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.code}: ${e.detail}`).join(' | ') || JSON.stringify(json);
    throw new Error(`ASC API ${method} ${resourcePath} failed (${res.status}): ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Steps ─────────────────────────────────────────────────────────────
async function waitForValidBuild(timeoutMs = 45 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const builds = await api(
      `/builds?filter[app]=${APP_NUMERIC_ID}&sort=-uploadedDate&limit=3` +
        `&fields[builds]=version,uploadedDate,processingState,expired`
    );
    const latest = builds.data?.[0];
    if (!latest) {
      console.log('No builds uploaded yet — retrying in 30s…');
      await sleep(30000);
      continue;
    }
    const a = latest.attributes;
    console.log(`Latest build ${a.version} (uploaded ${a.uploadedDate}) — processing state: ${a.processingState}`);
    if (a.processingState === 'VALID') return latest;
    if (a.processingState === 'FAILED' || a.processingState === 'INVALID') {
      throw new Error(`Latest build ${a.version} ended up ${a.processingState}. Inspect it in App Store Connect → TestFlight.`);
    }
    await sleep(30000);
  }
  throw new Error('Timed out waiting for App Store Connect to finish processing the build.');
}

async function findVersion() {
  const versions = await api(
    `/apps/${APP_NUMERIC_ID}/appStoreVersions?fields[appStoreVersions]=versionString,appStoreState&limit=5`
  );
  const list = versions.data || [];
  console.log('App Store versions:');
  for (const v of list) console.log(`  • ${v.attributes.versionString} → ${v.attributes.appStoreState}`);
  const target =
    list.find((v) => v.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION') ||
    list.find((v) => v.attributes.appStoreState === 'DEVELOPER_REJECTED') ||
    list[0];
  if (!target) throw new Error('No App Store version found — create version 1.0.0 in App Store Connect first.');
  return target;
}

async function main() {
  console.log('⏳ Step 1/3: waiting for the newest build to become VALID…');
  const build = await waitForValidBuild();
  console.log(`✅ Build ${build.attributes.version} is VALID (export compliance auto-passes via ITSAppUsesNonExemptEncryption=false).`);

  console.log('\n⏳ Step 2/3: locating App Store version…');
  const version = await findVersion();
  const state = version.attributes.appStoreState;
  console.log(`Target version ${version.attributes.versionString} is in state ${state}.`);

  if (['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_APPROVED', 'READY_FOR_SALE'].includes(state)) {
    console.log(`ℹ️ Version is already "${state}" — nothing left to do.`);
    return;
  }

  // Apple requires the build's version (CFBundleShortVersionString) to match
  // the App Store version string when attaching. ASC currently has "1.0" for
  // TimeTrack while the build is "1.0.0" — align them automatically.
  const buildVersion = build.attributes.version;
  if (version.attributes.versionString !== buildVersion) {
    console.log(`🔧 Aligning ASC version string "${version.attributes.versionString}" → "${buildVersion}"…`);
    await api(`/appStoreVersions/${version.id}`, 'PATCH', {
      data: { type: 'appStoreVersions', id: version.id, attributes: { versionString: buildVersion } },
    });
    version.attributes.versionString = buildVersion;
    console.log('✅ Version string updated.');
  }

  console.log(`\n🔗 Attaching build ${buildVersion} to version ${version.attributes.versionString}…`);
  await api(`/appStoreVersions/${version.id}`, 'PATCH', {
    data: {
      type: 'appStoreVersions',
      id: version.id,
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
  console.log('✅ Build attached to version.');

  console.log('\n📤 Step 3/3: submitting for App Review…');
  await api('/appStoreVersionSubmissions', 'POST', {
    data: {
      type: 'appStoreVersionSubmissions',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
    },
  });
  console.log('\n🎉 SUCCESS: TimeTrack is now "Waiting for Review" in App Store Connect.');
  console.log('Track progress at https://appstoreconnect.apple.com/apps/6803827296');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});