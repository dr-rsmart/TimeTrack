/**
 * release-ios-asc.mjs
 * -------------------
 * Releases the APPROVED TimeTrack App Store version sitting in
 * PENDING_DEVELOPER_RELEASE (releaseType MANUAL) so it becomes publicly
 * available on the App Store (READY_FOR_SALE).
 *
 * Official App Store Connect API resource:
 *   POST /v1/appStoreVersionReleaseRequests
 *
 * Guardrails (never blind-fires):
 *  - Only acts when an iOS version is PENDING_DEVELOPER_RELEASE AND its
 *    attached build is VALID and not expired.
 *  - Aborts (no changes) for READY_FOR_SALE or any unexpected state.
 *
 * Usage:  node scripts/release-ios-asc.mjs
 *         npm run release:ios
 *
 * Log markers:
 *   IOS_RELEASE_RESULT: LIVE | ALREADY | REQUESTED | ABORT | ERROR
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';

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

// ── ASC JWT auth (ES256) — identical to add-for-review-asc.mjs ──────────
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
  if (!res.ok) {
    const detail =
      json?.errors?.map((e) => `${e.code}: ${e.detail}`).join(' | ') || JSON.stringify(json);
    throw new Error(`ASC API ${method} ${resourcePath} failed (${res.status}): ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── Step 1: find the iOS App Store version(s) ─────────────────────────
  const versions = await api(
    `/apps/${APP_NUMERIC_ID}/appStoreVersions?filter[platform]=IOS&limit=5` +
      `&fields[appStoreVersions]=appStoreState,versionString,releaseType`,
  );
  const list = versions.data || [];
  if (list.length === 0) {
    console.log('No iOS App Store versions found.');
    console.log('IOS_RELEASE_RESULT: ERROR');
    return;
  }
  for (const v of list) {
    console.log(
      `  • iOS version "${v.attributes.versionString}" → ${v.attributes.appStoreState} (${v.attributes.releaseType})`,
    );
  }

  // ── Step 2: guardrails ────────────────────────────────────────────────
  const alreadyLive = list.some((v) => v.attributes.appStoreState === 'READY_FOR_SALE');
  if (alreadyLive) {
    console.log('\n🎉 TimeTrack is already live on the App Store (READY_FOR_SALE).');
    console.log('IOS_RELEASE_RESULT: ALREADY');
    return;
  }

  const pending = list.filter((v) => v.attributes.appStoreState === 'PENDING_DEVELOPER_RELEASE');
  if (pending.length === 0) {
    console.log(
      `\n⛔ No version in PENDING_DEVELOPER_RELEASE. States found: ${list
        .map((v) => v.attributes.appStoreState)
        .join(', ')} — aborting without changes.`,
    );
    console.log('IOS_RELEASE_RESULT: ABORT');
    return;
  }

  // Prefer the pending version whose attached build is VALID.
  let chosen = null;
  for (const v of pending) {
    const rel = await api(`/appStoreVersions/${v.id}/relationships/build`).catch(() => null);
    const buildId = rel?.data?.id;
    if (!buildId) continue;
    const build = await api(
      `/builds/${buildId}?fields[builds]=version,processingState,expired`,
    ).catch(() => null);
    const a = build?.data?.attributes;
    const state = a?.processingState;
    const expired = a?.expired ?? true;
    console.log(
      `  • candidate "${v.attributes.versionString}": build ${a?.version ?? '?'} → ${state}${expired ? ' (expired!)' : ''}`,
    );
    if (state === 'VALID' && !expired) {
      chosen = { version: v, build: a };
      break;
    }
  }
  if (!chosen) {
    console.log('⛔ No pending version has a VALID, non-expired build — aborting without changes.');
    console.log('IOS_RELEASE_RESULT: ABORT');
    return;
  }

  // ── Step 3: submit the release request ────────────────────────────────
  const body = {
    data: {
      type: 'appStoreVersionReleaseRequests',
      relationships: {
        appStoreVersion: {
          data: { id: chosen.version.id, type: 'appStoreVersions' },
        },
      },
    },
  };
  console.log(
    `\n📤 Releasing version "${chosen.version.attributes.versionString}" (build ${chosen.build.version}) to the App Store…`,
  );
  try {
    const released = await api('/appStoreVersionReleaseRequests', 'POST', body);
    console.log(
      `✅ Release request accepted (id: ${released?.data?.id ?? 'n/a'}). Apple is publishing the version.`,
    );
  } catch (err) {
    // 409 / ENTITY_STATE_CHANGED means the release is already in flight.
    if (/409|ENTITY_STATE_CHANGED|ALREADY|conflict/i.test(err.message)) {
      console.log('ℹ️  A release request already exists for this version — treating as in flight.');
    } else {
      throw err;
    }
  }

  // ── Step 4: poll until READY_FOR_SALE ─────────────────────────────────
  for (let i = 0; i < 12; i++) {
    await sleep(20000);
    const v = await api(
      `/appStoreVersions/${chosen.version.id}?fields[appStoreVersions]=appStoreState,versionString`,
    );
    const state = v.data.attributes.appStoreState;
    console.log(`  … poll ${i + 1}: appStoreState=${state}`);
    if (state === 'READY_FOR_SALE') {
      console.log('\n🎉 TimeTrack 1.0.0 is now LIVE on the App Store (READY_FOR_SALE).');
      console.log('IOS_RELEASE_RESULT: LIVE');
      return;
    }
  }
  console.log(
    '\nℹ️  Release requested; state has not flipped to READY_FOR_SALE yet (Apple propagation).',
  );
  console.log('   Re-run this script to confirm.');
  console.log('IOS_RELEASE_RESULT: REQUESTED');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  console.log('IOS_RELEASE_RESULT: ERROR');
  process.exit(1);
});
