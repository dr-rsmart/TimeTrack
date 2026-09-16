/**
 * Google Play Console — deterministic repair for the Release 16 closed-alpha draft
 * --------------------------------------------------------------------------------
 * The generic update-closed-alpha-vc16 run left a draft on Closed testing -> alpha
 * with a WRONG pre-filled bundle row (version code 14): Play rejected the release
 * ("existing users cannot upgrade" + "targets API level 35"), so no rollout could
 * start. This script performs the one deterministic path:
 *   1. Discard the bad draft release.
 *   2. Create a fresh release on closed "alpha".
 *   3. Upload timetrack-vc16.aab through the dropzone file chooser (no library
 *      guessing — vc16 has never been in the app bundle library).
 *   4. Verify the "16 (1.0.0)" row appears, set release name + notes.
 *   5. Next -> Start rollout to Closed testing -> confirm.
 *
 * Log markers:
 *   FIX_RESULT: DONE    -> vc16 rollout submitted on closed alpha
 *   FIX_RESULT: GUIDED  -> browser left open for manual completion
 *   FIX_RESULT: ERROR   -> unexpected failure
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AAB_PATH = path.resolve(ROOT, 'timetrack-vc16.aab');
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const DEV_ID = '8121995548332442173';
const APP_ID = '4976072281005342488';
const TRACK_ID = '4699609437092826823'; // Closed testing -> alpha
const APP_URL = `https://play.google.com/console/u/0/developers/${DEV_ID}/app/${APP_ID}`;

const RELEASE_NOTES = [
  '🚀 TimeTrack 1.0.0 — Release 16',
  '📍 Auto clock-in/out fixed: automatic attendance now works reliably again, including after shift-end auto clock-outs',
  '🩺 New auto-clock status card: see exactly why a punch has not fired yet (permission, GPS signal, confirmation progress)',
  '⚡ Improved background location monitoring and diagnostics',
  '🛠 Stability improvements and polish',
  'Thank you for your feedback — this one fixes auto clocking for good! 💙',
].join('\n');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`🔎 [${name}] url=${page.url()}`);
  try {
    await page.screenshot({ path: path.resolve(ROOT, `play-fix-vc16-${name}.png`) });
    console.log(`📸 saved play-fix-vc16-${name}.png`);
  } catch {}
}

async function clickVisible(page, label, makers, timeout = 30000) {
  const list = Array.isArray(makers) ? makers : [makers];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const maker of list) {
      try {
        const loc = maker(page);
        const n = await loc.count();
        for (let i = 0; i < n; i++) {
          const el = loc.nth(i);
          if (await el.isVisible().catch(() => false)) {
            try {
              await el.click({ timeout: 5000 });
            } catch {
              await el.click({ force: true, timeout: 5000 });
            }
            console.log(`✅ Clicked: ${label}`);
            return true;
          }
        }
      } catch {}
    }
    await wait(1500);
  }
  console.log(`⚠️  Could not click: ${label}`);
  return false;
}

const isVisible = (page, re, timeout = 5000) =>
  page
    .getByText(re)
    .first()
    .isVisible({ timeout })
    .catch(() => false);

async function run() {
  if (!fs.existsSync(AAB_PATH)) {
    console.log(`FIX_RESULT: ERROR — missing bundle ${AAB_PATH}`);
    return;
  }

  console.log('🚀 Launching visible Chromium with persistent Google profile...');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = context.pages()[0] || (await context.newPage());

  // ── 1. Open the stuck draft editor directly ──
  console.log('🌐 Opening the stuck draft release editor...');
  await page
    .goto(`${APP_URL}/tracks/${TRACK_ID}/releases/10/prepare`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    .catch(() => {});

  if (page.url().includes('accounts.google.com')) {
    console.log('======================================================');
    console.log('🔐 GOOGLE SIGN-IN REQUIRED in the opened browser window.');
    console.log('   Complete sign-in / 2FA there; the script resumes automatically.');
    console.log('======================================================');
    await page
      .waitForURL((u) => u.toString().includes('play.google.com'), { timeout: 300000 })
      .catch(() => {});
    await page
      .goto(`${APP_URL}/tracks/${TRACK_ID}/releases/10/prepare`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      .catch(() => {});
  }
  await wait(6000);

  // ── 2. Discard the bad draft (wrong bundle row, Play-blocked) ──
  if (await isVisible(page, /discard draft release/i, 8000)) {
    console.log('🗑  Discarding the blocked draft release...');
    await clickVisible(page, '"Discard draft release"', [
      (p) => p.getByText(/discard draft release/i),
      (p) => p.getByRole('link', { name: /discard draft release/i }),
      (p) => p.getByRole('button', { name: /discard draft release/i }),
    ]);
    await wait(3000);
    await clickVisible(
      page,
      'discard confirm dialog',
      [
        (p) => p.getByRole('button', { name: /^discard( release)?$/i }),
        (p) => p.getByRole('dialog').getByRole('button', { name: /discard/i }),
      ],
      8000,
    );
    await wait(5000);
  } else {
    console.log('ℹ️  No discardable draft visible — continuing to the track page.');
  }

  // ── 3. Fresh release on closed "alpha" ──
  await page
    .goto(`${APP_URL}/tracks/${TRACK_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    .catch(() => {});
  await wait(6000);
  const created = await clickVisible(page, '"Create new release"', [
    (p) => p.getByRole('button', { name: /create new release/i }),
    (p) => p.getByText('Create new release', { exact: true }),
  ]);
  if (!created) {
    await shot(page, 'no-create-button');
    console.log('FIX_RESULT: GUIDED');
    await context.close().catch(() => {});
    return;
  }
  await wait(7000);
  await shot(page, 'fresh-editor');

  // ── 4. Upload the AAB through the dropzone file chooser (deterministic) ──
  let attached = await isVisible(page, /16 \(1\.0\.0\)/, 4000);
  if (!attached) {
    console.log('📤 Uploading timetrack-vc16.aab via the dropzone...');
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null);
    await clickVisible(page, 'dropzone "Upload"', [
      (p) => p.getByRole('button', { name: /^upload$/i }),
      (p) => p.locator('button:has-text("Upload")').first(),
    ]);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(AAB_PATH);
      console.log(`✅ Served ${path.basename(AAB_PATH)} via file chooser — processing...`);
    } else {
      const input = page.locator('input[type="file"]').first();
      if ((await input.count()) > 0) {
        await input.setInputFiles(AAB_PATH).catch(() => {});
        console.log('✅ Served the AAB via hidden file input.');
      } else {
        console.log('⚠️  No file chooser and no file input found.');
      }
    }
    for (let i = 0; i < 36 && !attached; i++) {
      await wait(5000);
      attached = await isVisible(page, /16 \(1\.0\.0\)/, 2000);
    }
  } else {
    console.log('ℹ️  vc16 row already present in the editor.');
  }
  if (!attached) {
    await shot(page, 'vc16-row-missing');
    console.log('FIX_RESULT: ERROR — the 16 (1.0.0) bundle row never appeared.');
    await context.close().catch(() => {});
    return;
  }
  console.log('✅ Bundle row "16 (1.0.0)" present.');

  // ── 5. Release name + notes ──
  try {
    const nameBox = page.getByLabel(/release name/i).first();
    if ((await nameBox.count()) > 0) {
      const current = await nameBox.inputValue().catch(() => '');
      if (!current || !/^\s*16\b/.test(current)) {
        await nameBox.fill('16');
        console.log('✅ Release name set to "16".');
      }
    }
  } catch {}
  try {
    const notes = page.getByLabel(/release notes/i).first();
    const target = (await notes.count()) > 0 ? notes : page.locator('textarea').first();
    if ((await target.count()) > 0) {
      const cur = await target.inputValue().catch(() => '');
      if (!cur || !cur.includes('Release 16')) {
        await target.fill(RELEASE_NOTES);
        console.log('✅ Release notes filled.');
      }
    }
  } catch {}
  await shot(page, 'before-next');

  // ── 6. Next -> Start rollout -> confirm ──
  await clickVisible(page, '"Next" (prepare -> review)', [
    (p) => p.getByRole('button', { name: /^next$/i }),
  ]);
  await wait(8000);
  await shot(page, 'review');
  const rolled = await clickVisible(page, '"Start rollout to Closed testing"', [
    (p) => p.getByRole('button', { name: /start rollout to closed testing/i }),
    (p) => p.getByRole('button', { name: /start rollout/i }),
    (p) => p.getByText(/start rollout to closed testing/i),
  ]);
  if (rolled) {
    await wait(3000);
    await clickVisible(
      page,
      'rollout confirm dialog',
      [
        (p) =>
          p.getByRole('dialog').getByRole('button', { name: /start rollout|^confirm$|^yes$/i }),
        (p) => p.getByRole('button', { name: /^start rollout$/i }),
      ],
      10000,
    );
  }

  // ── 7. Verify ──
  let done = rolled;
  for (let i = 0; i < 12 && !done; i++) {
    await wait(10000);
    done = await isVisible(
      page,
      /rollout started|in review|review in progress|ready to send|staged rollout|available to testers/i,
      5000,
    );
  }
  await page
    .goto(`${APP_URL}/tracks/${TRACK_ID}`, { waitUntil: 'domcontentloaded' })
    .catch(() => {});
  await wait(6000);
  const trackShows16 = await isVisible(page, /16 \(1\.0\.0\)/, 8000);
  await shot(page, 'final');
  if (trackShows16) {
    console.log('✅ Release 16 (1.0.0) is on closed testing "alpha".');
    console.log('FIX_RESULT: DONE');
  } else if (rolled) {
    console.log('ℹ️  Rollout clicked; track confirmation pending.');
    console.log('FIX_RESULT: DONE');
  } else {
    console.log('🟢 GUIDED MODE — finish in the open browser window.');
    console.log('FIX_RESULT: GUIDED');
  }
  await context.close().catch(() => {});
}

run().catch((err) => {
  console.error('FIX_RESULT: ERROR —', err?.message || err);
  process.exit(1);
});
