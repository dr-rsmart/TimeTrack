/**
 * update-ios-review-build.mjs
 * ---------------------------
 * Updates the TimeTrack iOS App Store listing so the newest VALID build
 * becomes the build under App Review. If the App Store version is currently
 * WAITING_FOR_REVIEW / IN_REVIEW with an older build attached, the existing
 * submission is removed (developer pull), the new build is attached, and the
 * version is resubmitted for review — fully non-interactively using the
 * App Store Connect API key (asc-api-key.json).
 *
 * Usage:  node scripts/update-ios-review-build.mjs
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
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok && !(method === 'DELETE' && res.status === 204)) {
    const detail =
      json?.errors?.map((e) => `${e.code}: ${e.detail}`).join(' | ') || JSON.stringify(json);
    throw new Error(`ASC API ${method} ${resourcePath} failed (${res.status}): ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional guard: --since <ISO timestamp> ensures we target a build uploaded
// after a known point in time (e.g. the EAS Submit completion), rather than
// an older build that is already VALID.
const args = process.argv.slice(2);
const sinceIdx = args.indexOf('--since');
const MIN_UPLOAD_MS = sinceIdx >= 0 && args[sinceIdx + 1] ? Date.parse(args[sinceIdx + 1]) : 0;
if (sinceIdx >= 0 && Number.isNaN(MIN_UPLOAD_MS)) {
  console.error('❌ Invalid --since timestamp:', args[sinceIdx + 1]);
  process.exit(1);
}
// ── Steps ─────────────────────────────────────────────────────────────
async function findVersion() {
  const versions = await api(
    `/apps/${APP_NUMERIC_ID}/appStoreVersions?fields[appStoreVersions]=versionString,appStoreState&limit=5`,
  );
  const list = versions.data || [];
  console.log('App Store versions:');
  for (const v of list)
    console.log(`  • ${v.attributes.versionString} → ${v.attributes.appStoreState}`);
  const target =
    list.find((v) => ['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(v.attributes.appStoreState)) ||
    list.find((v) => v.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION') ||
    list.find((v) => v.attributes.appStoreState === 'DEVELOPER_REJECTED') ||
    list[0];
  if (!target)
    throw new Error('No App Store version found — create one in App Store Connect first.');
  return target;
}

async function getAttachedBuild(versionId) {
  const res = await api(
    `/appStoreVersions/${versionId}?include=build&fields[builds]=version,uploadedDate,processingState`,
  );
  const build = res.included?.find((r) => r.type === 'builds');
  return build || null;
}

async function waitForNewValidBuild(uploadedAfterMs, timeoutMs = 45 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const builds = await api(
      `/builds?filter[app]=${APP_NUMERIC_ID}&sort=-uploadedDate&limit=3` +
        `&fields[builds]=version,uploadedDate,processingState,expired`,
    );
    const latest = builds.data?.[0];
    if (!latest) {
      console.log('No builds uploaded yet — retrying in 30s…');
      await sleep(30000);
      continue;
    }
    const a = latest.attributes;
    const uploadedMs = Date.parse(a.uploadedDate);
    console.log(
      `Latest visible build ${a.version} (uploaded ${a.uploadedDate}) — processing state: ${a.processingState}`,
    );
    if (uploadedMs >= MIN_UPLOAD_MS) {
      if (a.processingState === 'FAILED' || a.processingState === 'INVALID') {
        throw new Error(
          `Latest build ${a.version} ended up ${a.processingState}. Inspect it in App Store Connect → TestFlight.`,
        );
      }
      if (a.processingState === 'VALID' && uploadedMs > uploadedAfterMs) return latest;
    } else {
      console.log('Newer upload not visible in App Store Connect yet — retrying in 30s…');
    }
    await sleep(30000);
  }
  throw new Error('Timed out waiting for App Store Connect to finish processing the new build.');
}

async function main() {
  console.log('⏳ Step 1/5: locating App Store version…');
  const version = await findVersion();
  let state = version.attributes.appStoreState;
  console.log(`Target version ${version.attributes.versionString} is in state ${state}.`);

  if (['PENDING_DEVELOPER_RELEASE', 'READY_FOR_SALE'].includes(state)) {
    throw new Error(
      `Version is "${state}" — the build cannot be swapped in this state. Create a new version in App Store Connect.`,
    );
  }

  console.log('\n⏳ Step 2/5: checking currently attached build…');
  let attached = await getAttachedBuild(version.id);
  if (attached) {
    console.log(
      `Attached build: ${attached.attributes.version} (uploaded ${attached.attributes.uploadedDate}).`,
    );
  } else {
    console.log('No build currently attached to the version.');
  }

  console.log('\n⏳ Step 3/5: waiting for the newer build to become VALID…');
  const uploadedAfterMs = attached ? Date.parse(attached.attributes.uploadedDate) : 0;
  const build = await waitForNewValidBuild(uploadedAfterMs);
  console.log(
    `✅ Build ${build.attributes.version} (uploaded ${build.attributes.uploadedDate}) is VALID.`,
  );

  if (attached && attached.id === build.id) {
    console.log('ℹ️ The newest build is already attached — nothing left to do.');
    return;
  }

  if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(state)) {
    console.log(`\n⏳ Step 4/5: removing version from review so the build can be swapped…`);
    const sub = await api(`/appStoreVersions/${version.id}/appStoreVersionSubmission`);
    if (sub?.data?.id) {
      await api(`/appStoreVersionSubmissions/${sub.data.id}`, 'DELETE');
      console.log('✅ Existing submission removed (developer pull).');
    } else {
      console.log('ℹ️ No active submission found despite review state — continuing.');
    }
    // Wait for the state change to propagate.
    for (let i = 0; i < 10; i++) {
      await sleep(5000);
      const v = await api(`/appStoreVersions/${version.id}?fields[appStoreVersions]=appStoreState`);
      state = v.data.attributes.appStoreState;
      if (!['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(state)) break;
    }
    console.log(`Version state is now ${state}.`);
  } else {
    console.log('\n⏳ Step 4/5: version is not in review — no removal needed.');
  }

  console.log(
    `\n🔗 Attaching build ${build.attributes.version} to version ${version.attributes.versionString}…`,
  );
  await api(`/appStoreVersions/${version.id}`, 'PATCH', {
    data: {
      type: 'appStoreVersions',
      id: version.id,
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
  console.log('✅ Build attached to version.');

  console.log(
    '\n📤 Step 5/5: submitting for App Review (using App Store Connect Review Submissions API)…',
  );
  let submitted = false;
  for (let attempt = 1; attempt <= 3 && !submitted; attempt++) {
    try {
      // 1. Check if there's an existing review submission in progress for iOS
      const existingSubmissions = await api(
        `/apps/${APP_NUMERIC_ID}/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`,
      );
      let submissionId;
      if (existingSubmissions.data && existingSubmissions.data.length > 0) {
        submissionId = existingSubmissions.data[0].id;
        console.log(`Found existing READY_FOR_REVIEW submission: ${submissionId}`);
      } else {
        // Create a new review submission
        const newSubmission = await api('/reviewSubmissions', 'POST', {
          data: {
            type: 'reviewSubmissions',
            attributes: { platform: 'IOS' },
            relationships: { app: { data: { type: 'apps', id: APP_NUMERIC_ID } } },
          },
        });
        submissionId = newSubmission.data.id;
        console.log(`Created new review submission: ${submissionId}`);
      }

      // 2. Check if the appStoreVersion is already added as an item
      const submissionWithItems = await api(`/reviewSubmissions/${submissionId}?include=items`);
      const hasItem = submissionWithItems.included?.some(
        (item) =>
          item.type === 'reviewSubmissionItems' &&
          item.relationships?.appStoreVersion?.data?.id === version.id,
      );

      if (!hasItem) {
        console.log(
          `Adding App Store version ${version.attributes.versionString} to review submission…`,
        );
        await api('/reviewSubmissionItems', 'POST', {
          data: {
            type: 'reviewSubmissionItems',
            relationships: {
              reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
              appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
            },
          },
        });
        console.log('✅ Version added to review submission.');
      } else {
        console.log('ℹ️ Version is already added to review submission.');
      }

      // 3. Submit the review submission
      console.log('Submitting review submission to Apple…');
      await api(`/reviewSubmissions/${submissionId}`, 'PATCH', {
        data: {
          type: 'reviewSubmissions',
          id: submissionId,
          attributes: { submitted: true },
        },
      });
      submitted = true;
    } catch (err) {
      if (attempt < 3 && /FORBIDDEN|state/i.test(err.message)) {
        console.log(
          `⚠️ Attempt ${attempt} rejected (${err.message}) — Apple state may still be settling. Retrying in 60s…`,
        );
        await sleep(60000);
      } else {
        throw err;
      }
    }
  }
  console.log(
    '\n🎉 SUCCESS: iOS updated — the newest build is now "Waiting for Review" in App Store Connect.',
  );
  console.log('Track progress at https://appstoreconnect.apple.com/apps/6803827296');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
