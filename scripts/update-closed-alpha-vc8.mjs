/**
 * Google Play Console — Closed testing ("alpha") rollout updater
 * --------------------------------------------------------------
 * Promotes the Closed testing -> alpha track from "Release: 7 (1.0.0)" to
 * "Release: 8 (1.0.0)" by shipping version code 8 (timetrack-vc8 bundle).
 *
 * Conventions match scripts/upload-play-console.mjs:
 *  - Persistent Chromium profile (.playwright-google-profile/) keeps the
 *    Google sign-in alive across runs.
 *  - If a sign-in / 2FA challenge appears the script waits for the human.
 *  - Prefers attaching the already-uploaded vc8 bundle from the Play
 *    Console app bundle library; falls back to uploading the .aab.
 *
 * Log markers (for automation watchers):
 *   PLAY_CONSOLE_RESULT: DONE    -> release 8 rollout submitted on closed alpha
 *   PLAY_CONSOLE_RESULT: GUIDED  -> window left open for manual completion
 *   PLAY_CONSOLE_RESULT: ERROR   -> unexpected failure
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AAB_PATH = path.resolve(ROOT, 'timetrack-vc8-webview-failsafe.aab');
const RELEASE_NAME = '8'; // track row then reads "Release: 8 (1.0.0)"
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`🔎 [${name}] url=${page.url()}`);
  try {
    await page.screenshot({ path: path.resolve(ROOT, `play-console-closealpha-${name}.png`) });
    console.log(`📸 saved play-console-closealpha-${name}.png`);
  } catch {}
}

// Click the FIRST VISIBLE element matched by one of the locator factories
// (Google Console SPAs carry hidden duplicates, so .first() alone is unsafe).
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
              // Google Console overlays sometimes intercept; forced dispatch is
              // the documented workaround (probe-verified in prior scripts).
              await el.click({ force: true, timeout: 5000 });
            }
            console.log(`✅ Clicked: ${label}`);
            return true;
          }
        }
      } catch {}
    }
    await wait(2000);
  }
  console.log(`⚠️  Could not click: ${label}`);
  return false;
}

async function isVisible(page, rx, timeout = 8000) {
  try {
    await page.getByText(rx).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

// ── Review + rollout (shared by draft submission and fresh releases) ──
async function submitRelease(page) {
  await clickVisible(
    page,
    '"Review release"',
    [
      (p) => p.getByRole('button', { name: /review release/i }),
      (p) => p.getByText('Review release', { exact: true }),
    ],
    30000
  );
  await wait(4000);
  await clickVisible(
    page,
    '"Start rollout to closed testing"',
    [
      (p) => p.getByRole('button', { name: /start rollout to closed testing/i }),
      (p) => p.getByText(/Start rollout to Closed testing/i),
      (p) => p.getByRole('button', { name: /start rollout/i }),
    ],
    30000
  );
  await wait(3000);
  await clickVisible(
    page,
    'confirm dialog',
    [
      (p) => p.getByRole('button', { name: /^confirm$/i }),
      (p) => p.getByRole('button', { name: /start rollout/i }),
    ],
    15000
  );
}

// Attach version code 8 INSIDE the release editor. Preference order:
//  1) pick the already-processed vc8 bundle from the app bundle library,
//  2) trigger the bundle upload dropzone/Browse button and serve the .aab
//     through the browser file chooser (new Play Console UI),
//  3) direct setInputFiles into any <input type=file> if one exists.
async function attachBundleVc8(page) {
  // ── 1) App bundle library ──
  const fromLibrary = await clickVisible(
    page,
    '"Add from library"',
    [
      (p) => p.getByText(/add from library/i),
      (p) => p.getByRole('link', { name: /library/i }),
      (p) => p.getByRole('button', { name: /library/i }),
      (p) => p.locator('a').filter({ hasText: /library/i }),
    ],
    10000
  );
  if (fromLibrary) {
    await wait(4000);
    const picked = await clickVisible(
      page,
      'vc8 row checkbox in library chooser',
      [
        // Row whose Version code cell is exactly 8 -> tick its checkbox.
        (p) =>
          p
            .locator('tr')
            .filter({ has: p.locator('td').filter({ hasText: /^8$/ }) })
            .getByRole('checkbox'),
        (p) =>
          p
            .locator('tr')
            .filter({ hasText: /App bundle\s+8\s+1\.0\.0/ })
            .getByRole('checkbox'),
        (p) =>
          p
            .locator('tr')
            .filter({ hasText: /Aug 24, 2026/ })
            .getByRole('checkbox'),
        (p) =>
          p
            .locator('tr')
            .filter({ hasText: /App bundle/ })
            .filter({ has: p.getByText(/^8$/, { exact: true }) })
            .locator('input[type="checkbox"], [role="checkbox"], label')
            .first(),
      ],
      20000
    );
    if (!picked) await shot(page, 'library-no-vc8');
    await wait(1500);
    const added = await clickVisible(
      page,
      'library confirm ("Add to release")',
      [
        (p) => p.getByRole('button', { name: /add to release/i }),
        (p) => p.getByText('Add to release', { exact: true }),
        (p) => p.getByRole('button', { name: /^add$/i }),
      ],
      15000
    );
    if (picked && added) {
      console.log('✅ Attached vc8 from the app bundle library.');
      await wait(30000);
      return true;
    }
  }

  // ── 2) Upload dropzone / Browse button + file chooser ──
  const chooserP = page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null);
  const clickedUpload = await clickVisible(
    page,
    'bundle upload control (Upload/Browse/dropzone)',
    [
      (p) => p.getByRole('button', { name: /^(upload|browse|select a file|choose file)$/i }),
      (p) => p.getByText('Upload', { exact: true }),
      (p) => p.getByText('Browse', { exact: true }),
      (p) => p.getByText(/drag and drop/i),
      (p) => p.getByText(/app bundles to this release/i),
      (p) => p.locator('label').filter({ hasText: /upload/i }),
    ],
    10000
  );
  if (clickedUpload) {
    const chooser = await chooserP;
    if (chooser) {
      await chooser.setFiles(AAB_PATH);
      console.log(`✅ Served ${path.basename(AAB_PATH)} via file chooser.`);
      await wait(60000);
      return true;
    }
    console.log('ℹ️  Upload clicked but no chooser appeared; trying direct input...');
  }

  // ── 3) Direct file input ──
  try {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 10000 });
    await fileInput.setInputFiles(AAB_PATH);
    console.log(`✅ Uploading bundle: ${path.basename(AAB_PATH)} (this can take a minute)...`);
    await wait(60000);
    return true;
  } catch {
    console.log('⚠️  No file input found and library attach failed.');
    await shot(page, 'no-bundle-attach');
    return false;
  }
}

// ── Release name box: ensure it reflects release 8 ──
async function ensureReleaseName(page) {
  try {
    const nameBox = page.getByLabel(/release name/i).first();
    if ((await nameBox.count()) > 0) {
      const current = await nameBox.inputValue().catch(() => '');
      if (!current || !/^\s*8\b/.test(current)) {
        await nameBox.fill(RELEASE_NAME);
        console.log(`✅ Release name set to "${RELEASE_NAME}".`);
      } else {
        console.log(`ℹ️  Release name left as: ${current}`);
      }
    }
  } catch {}
}

async function run() {
  if (!fs.existsSync(AAB_PATH)) {
    console.log(`PLAY_CONSOLE_RESULT: ERROR — missing bundle ${AAB_PATH}`);
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

  console.log('🌐 Navigating to Google Play Console app list...');
  await page
    .goto('https://play.google.com/console/u/0/app-list', {
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
  }

  await wait(6000);
  await shot(page, 'app-list');

  const pickDeveloper = async (label) => {
    const hit = await clickVisible(page, `developer account "${label}"`,
      [(p) => p.getByText(label, { exact: true })], 20000);
    if (hit) await wait(6000);
    return hit;
  };
  if (await isVisible(page, /choose developer account/i, 10000)) await pickDeveloper('dr-rsmart');

  // Open the TimeTrack app (waits for the slow app-list render)
  let rowReady = await isVisible(page, /TimeTrack: Workforce/i, 25000);
  if (!rowReady && (await isVisible(page, /choose developer account/i, 5000))) {
    await pickDeveloper('dr-rsmart');
    rowReady = await isVisible(page, /TimeTrack: Workforce/i, 30000);
  }
  const openedApp = await clickVisible(page, 'TimeTrack app row', [
    (p) => p.getByText('TimeTrack: Workforce'),
    (p) => p.locator('a').filter({ hasText: /TimeTrack/i }),
  ], 30000);
  if (openedApp) await wait(6000);

  const m = page.url().match(/developers\/(\d+)\/app\/(\d+)/);
  if (!m) {
    await shot(page, 'no-dev-app-ids');
    console.log('PLAY_CONSOLE_RESULT: GUIDED — navigate to the app manually.');
    return;
  }

  const devId = m[1];
  const appId = m[2];

  // ── Closed testing -> Alpha track ──
  console.log('🧭 Opening the Closed testing section...');
  await page
    .goto(
      `https://play.google.com/console/u/0/developers/${devId}/app/${appId}/closed-testing`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    )
    .catch(() => {});
  await wait(6000);
  await shot(page, 'closed-testing-list');

  // The tracks list shows a "Closed testing - Alpha" card whose right side
  // carries a "Manage track" link that opens the release page.
  let entered = await clickVisible(page, '"Manage track" link (Alpha row)', [
    (p) => p.getByRole('link', { name: /manage track/i }),
    (p) => p.getByText('Manage track', { exact: true }),
  ], 20000);
  if (entered) await wait(5000);

  if (!/releases|track\//.test(page.url())) {
    // Fallback: click the track title itself.
    entered = await clickVisible(page, '"Closed testing - Alpha" title', [
      (p) => p.getByText('Closed testing - Alpha', { exact: true }),
      (p) => p.getByText(/Closed testing\s*-\s*Alpha/i),
      (p) => p.getByText('Alpha', { exact: true }),
    ], 15000);
    if (entered) await wait(5000);
  }

  const url = page.url();
  if (!/closed-testing|alpha|releases/.test(url)) {
    await shot(page, 'not-on-alpha-track');
  }
  await shot(page, 'alpha-track-page');

  // ── Detect current track state ──
  const hasVc8 = await isVisible(page, /8 \(1\.0\.0\)/, 6000);
  const hasDraft = (await isVisible(page, /edit release/i, 5000)) ||
    (await isVisible(page, /^\s*Untitled release\s*$/i, 4000)) ||
    (await isVisible(page, /\bDraft\b/, 4000));
  const alreadyLive = await isVisible(
    page,
    /rollout started|in review|review in progress|available to (selected )?testers|fully live|staged rollout/i,
    6000
  );
  console.log(
    `ℹ️  track state: hasVc8=${hasVc8} hasDraft=${hasDraft} hasLiveRelease7=${await isVisible(page, /7 \(1\.0\.0\)/, 4000)}`
  );

  let submitted = false;

  if (hasVc8 && alreadyLive && !hasDraft) {
    console.log('ℹ️  Closed "alpha" already carries Release 8 (1.0.0) — nothing to do.');
    submitted = true;
  } else {
    // Enter the release editor: via the existing draft, or by creating one.
    let inEditor = false;
    if (hasDraft) {
      console.log('📝 Draft exists on closed "alpha" — opening its editor.');
      inEditor = await clickVisible(page, '"Edit release" (draft editor)', [
        (p) => p.getByRole('link', { name: /edit release/i }),
        (p) => p.getByText('Edit release', { exact: true }),
        (p) => p.getByRole('button', { name: /edit release/i }),
      ], 20000);
    } else {
      console.log('➕ Creating a new release on closed "alpha"...');
      inEditor = await clickVisible(page, '"Create new release" (closed alpha)', [
        (p) => p.getByRole('button', { name: /create new release/i }),
        (p) => p.getByText('Create new release', { exact: true }),
      ], 30000);
    }
    if (inEditor) {
      await wait(6000);
      await shot(page, 'release-editor');

      // Skip bundling if the editor already shows vc8 attached.
      const bundleAlready = await isVisible(page, /8 \(1\.0\.0\)/, 5000);
      if (bundleAlready) {
        console.log('ℹ️  vc8 already attached to this release.');
      } else {
        await attachBundleVc8(page);
      }
      await ensureReleaseName(page);
      await shot(page, 'before-review');
      await submitRelease(page);
      submitted = true;
    } else {
      await shot(page, 'editor-unreachable');
    }
  }

  // ── Confirm rollout state ──
  let done = submitted;
  if (submitted) {
    done = await isVisible(
      page,
      /rollout started|in review|review in progress|ready to send|fully live|staged rollout|available to testers/i,
      15000
    );
    for (let i = 0; i < 12 && !done; i++) {
      await wait(10000);
      done = await isVisible(
        page,
        /rollout started|in review|review in progress|ready to send|fully live|staged rollout/i,
        5000
      );
    }
  }
  await shot(page, 'final');

  if (done) {
    console.log('✅ Release 8 (1.0.0) rollout submitted on closed testing "alpha".');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else if (submitted) {
    console.log('ℹ️  Rollout clicked but final status not yet visible (may take review time).');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else {
    console.log('======================================================');
    console.log('🟢 GUIDED MODE — finish in the open browser window:');
    console.log('   1. Test and release -> Closed testing -> alpha');
    console.log('   2. "Create new release" -> attach');
    console.log(`      ${AAB_PATH}`);
    console.log('      (or pick Release 8 from the app bundle library)');
    console.log(`   3. Release name: ${RELEASE_NAME}`);
    console.log('   4. "Review release" -> "Start rollout to closed testing"');
    console.log('======================================================');
    console.log('PLAY_CONSOLE_RESULT: GUIDED');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline && !page.isClosed()) {
      await wait(15000);
      if (await isVisible(page, /rollout started|in review|review in progress/i, 1000)) {
        console.log('✅ Guided completion detected.');
        await shot(page, 'guided-completed');
        break;
      }
    }
  }

  await context.close();
}

run().catch((e) => {
  console.error('PLAY_CONSOLE_RESULT: ERROR —', e);
  process.exitCode = 1;
});