/**
 * verify-store-release.mjs
 * ------------------------
 * Confirms the PUBLIC release state on BOTH stores:
 *  - iOS:   App Store Connect API (no browser) — READY_FOR_SALE check.
 *  - Android: Google Play Console (visible Chromium, persistent profile) —
 *    production track page check for live markers.
 *
 * Usage:  node scripts/verify-store-release.mjs
 *         npm run verify:stores
 *
 * Log markers:
 *   IOS_STORE: LIVE | NOT_LIVE(<state>) | ERROR
 *   PLAY_STORE: LIVE | NOT_LIVE | GATED | UNKNOWN
 *   VERIFY_STORES: PASS | FAIL
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── iOS (ASC API) ───────────────────────────────────────────────────────
const APP_NUMERIC_ID = '6803827296';
const API_BASE = 'https://api.appstoreconnect.apple.com/v1';
const KEY_FILE = path.join(ROOT, 'asc-api-key.json');

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let key = null;
if (fs.existsSync(KEY_FILE)) {
  key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
}

function signJwt() {
  const header = { alg: 'ES256', kid: key.key_id, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: key.issuer_id, iat: now, exp: now + 10 * 60, aud: 'appstoreconnect-v1' };
  const payload = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = crypto
    .createSign('SHA256')
    .update(payload)
    .sign({ key: key.key_p8, dsaEncoding: 'ieee-p1363' });
  return `${payload}.${b64url(sig)}`;
}

async function iosStoreState() {
  if (!key) {
    console.log('IOS_STORE: ERROR (asc-api-key.json missing)');
    return false;
  }
  const token = signJwt();
  try {
    const res = await fetch(
      `${API_BASE}/apps/${APP_NUMERIC_ID}/appStoreVersions?filter[platform]=IOS&limit=3` +
        `&fields[appStoreVersions]=appStoreState,versionString`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json?.errors || json).slice(0, 400));
    const live = (json.data || []).find((v) => v.attributes.appStoreState === 'READY_FOR_SALE');
    if (live) {
      console.log(
        `IOS_STORE: LIVE — version ${live.attributes.versionString} is READY_FOR_SALE on the App Store.`,
      );
      return true;
    }
    const states = (json.data || [])
      .map((v) => `${v.attributes.versionString}=${v.attributes.appStoreState}`)
      .join(', ');
    console.log(`IOS_STORE: NOT_LIVE(${states || 'none'})`);
    return false;
  } catch (err) {
    console.log(`IOS_STORE: ERROR — ${err.message}`);
    return false;
  }
}

// ── Android (Play Console, browser) ─────────────────────────────────────
const DEV = '8121995548332442173';
const APP = '4976072281005342488';
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function playStoreState() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    const appBase = `https://play.google.com/console/u/0/developers/${DEV}/app/${APP}`;
    await page
      .goto(`${appBase}/test-and-release`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {});
    if (page.url().includes('accounts.google.com')) {
      console.log('🔐 Play Console sign-in required in the opened window.');
      await page
        .waitForURL((u) => u.toString().includes('play.google.com'), { timeout: 300000 })
        .catch(() => {});
    }
    await wait(6000);
    let reached = false;
    for (const tail of ['releases/production', 'production']) {
      await page
        .goto(`${appBase}/${tail}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        .catch(() => {});
      await wait(6000);
      if (/production/i.test(page.url())) {
        reached = true;
        break;
      }
    }
    if (!reached) {
      try {
        await page
          .getByRole('link', { name: /^production$/i })
          .first()
          .click({ timeout: 10000 });
        await wait(6000);
        if (/production/i.test(page.url())) reached = true;
      } catch {}
    }
    const text = await page
      .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      .catch(() => '');
    const t = text.slice(0, 6000);
    if (/requirements? before (you )?(can )?releas|testers (for|over) \d+ days/i.test(t)) {
      console.log('PLAY_STORE: GATED — production eligibility requirement still showing.');
      return false;
    }
    if (/fully live|available on google play|published/i.test(t)) {
      console.log('PLAY_STORE: LIVE — production track shows a published release.');
      return true;
    }
    if (/in review|review in progress/i.test(t)) {
      console.log('PLAY_STORE: NOT_LIVE — release in review.');
      return false;
    }
    console.log('PLAY_STORE: UNKNOWN — production page did not show a live release.');
    return false;
  } catch (err) {
    console.log(`PLAY_STORE: ERROR — ${err.message}`);
    return false;
  } finally {
    await context.close().catch(() => {});
  }
}

const iosLive = await iosStoreState();
const playLive = await playStoreState();
if (iosLive && playLive) {
  console.log(
    '\n✅ VERIFY_STORES: PASS — TimeTrack is public on BOTH the App Store and Google Play.',
  );
} else {
  console.log('\n⚠️  VERIFY_STORES: FAIL — at least one store is not fully live yet (see above).');
}
process.exit(iosLive && playLive ? 0 : 1);
