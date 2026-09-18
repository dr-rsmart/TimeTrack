/**
 * Google Play Console — Closed testing ("alpha") rollout updater
 * --------------------------------------------------------------
 * Promotes the Closed testing -> alpha track from "Release: 17 (1.0.0)" to
 * "Release: 18 (1.0.0)" by shipping version code 18 (timetrack-vc18 bundle:
 * EAS build #18 — targets API 36 per the Google Play Aug-2026 policy).
 *
 * Conventions match scripts/upload-play-console.mjs:
 *  - Persistent Chromium profile (.playwright-google-profile/) keeps the
 *    Google sign-in alive across runs.
 *  - If a sign-in / 2FA challenge appears the script waits for the human.
 *  - Prefers attaching the already-uploaded vc18 bundle from the Play
 *    Console app bundle library; falls back to uploading the .aab.
 *
 * Log markers (for automation watchers):
 *   PLAY_CONSOLE_RESULT: DONE    -> release 18 rollout submitted on closed alpha
 *   PLAY_CONSOLE_RESULT: GUIDED  -> window left open for manual completion
 *   PLAY_CONSOLE_RESULT: ERROR   -> unexpected failure
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AAB_PATH = path.resolve(ROOT, 'timetrack-vc18.aab');
const RELEASE_NAME = '18'; // track row then reads "Release: 18 (1.0.0)"
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
  // Current Play Console flow: the prepare page ends with a "Next" button
  // that leads to the review page where the rollout button lives. Wait
  // generously — "Next" stays disabled while the bundle is still processing.
  await clickVisible(
    page,
    '"Next" (prepare -> review)',
    [
      (p) => p.getByRole('button', { name: /^next$/i }),
      (p) => p.getByText('Next', { exact: true }),
    ],
    60000,
  );
  await wait(5000);
  // A second "Next" may appear (release notes / country selection pages).
  await clickVisible(
    page,
    'second "Next" (if present)',
    [(p) => p.getByRole('button', { name: /^next$/i })],
    8000,
  );
  await wait(3000);
  // 2026 UI: the review step persists via "Save" first; the rollout button
  // only appears once the draft is saved and validation is clean.
  await clickVisible(
    page,
    '"Save" (review step)',
    [
      (p) => p.getByRole('button', { name: /^save$/i }),
      (p) => p.getByText('Save', { exact: true }),
    ],
    20000,
  );
  await wait(6000);
  await clickVisible(
    page,
    '"Review release"',
    [
      (p) => p.getByRole('button', { name: /review release/i }),
      (p) => p.getByText('Review release', { exact: true }),
    ],
    30000,
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
    30000,
  );
  await wait(3000);
  await clickVisible(
    page,
    'confirm dialog',
    [
      (p) => p.getByRole('button', { name: /^confirm$/i }),
      (p) => p.getByRole('button', { name: /start rollout/i }),
    ],
    15000,
  );
}

// Attach version code 18 INSIDE the release editor. Preference order:
//  1) pick the already-processed vc18 bundle from the app bundle library,
//  2) trigger the bundle upload dropzone/Browse button and serve the .aab
//     through the browser file chooser (new Play Console UI),
//  3) direct setInputFiles into any <input type=file> if one exists.
async function attachBundleVc17(page) {
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
    10000,
  );
  if (fromLibrary) {
    await wait(4000);
    // SAFETY: bundle 18 may not exist in the library yet (this is its first
    // Play upload). NEVER click a checkbox blindly — the old .nth(1) fallback
    // once attached bundle 15 under a "18" release name (verified via the
    // before-review screenshot). Only select a row when a "18" version cell
    // is actually visible in the chooser.
    const has17Row = await isVisible(page, /App bundle\s+18\s+1\.0\.0/, 4000);
    const picked = has17Row
      ? await clickVisible(
          page,
          'vc18 row checkbox in library chooser',
          [
            // Dialog table is custom (no <tr>): the row checkbox precedes the
            // unique version-code cell text "18".
            (p) =>
              p.locator(
                'xpath=(//*[normalize-space(text())="18"]/preceding::*[self::input[@type="checkbox"] or @role="checkbox"])[last()]',
              ),
            (p) =>
              p
                .locator('tr')
                .filter({ has: p.locator('td').filter({ hasText: /^18$/ }) })
                .getByRole('checkbox'),
            (p) =>
              p
                .locator('tr')
                .filter({ hasText: /App bundle\s+18\s+1\.0\.0/ })
                .getByRole('checkbox'),
          ],
          20000,
        )
      : false;
    if (!has17Row) {
      console.log(
        'ℹ️  Bundle 18 is not in the library yet — closing the dialog and uploading the .aab instead.',
      );
      await page.keyboard.press('Escape').catch(() => {});
      await wait(1000);
      await clickVisible(
        page,
        'library dialog close/cancel',
        [
          (p) => p.locator('[role="dialog"]').getByRole('button', { name: /^(close|cancel)$/i }),
          (p) => p.getByRole('button', { name: /^(close|cancel)$/i }),
        ],
        6000,
      );
      await wait(2000);
    } else if (!picked) {
      await shot(page, 'library-no-vc18');
    }
    await wait(1500);
    const added = picked
      ? await clickVisible(
          page,
          'library confirm ("Add to release")',
          [
            (p) => p.getByRole('button', { name: /add to release/i }),
            (p) => p.getByText('Add to release', { exact: true }),
            (p) => p.getByRole('button', { name: /^add$/i }),
          ],
          15000,
        )
      : false;
    if (picked && added) {
      console.log('✅ Attached vc18 from the app bundle library.');
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
    10000,
  );
  if (clickedUpload) {
    const chooser = await chooserP;
    if (chooser) {
      await chooser.setFiles(AAB_PATH);
      console.log(`✅ Served ${path.basename(AAB_PATH)} via file chooser.`);
      await wait(90000);
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
    await wait(90000);
    return true;
  } catch {
    console.log('⚠️  No file input found and library attach failed.');
    await shot(page, 'no-bundle-attach');
    return false;
  }
}

// ── Release name box: ensure it reflects release 18 ──
async function ensureReleaseName(page) {
  try {
    const nameBox = page.getByLabel(/release name/i).first();
    if ((await nameBox.count()) > 0) {
      const current = await nameBox.inputValue().catch(() => '');
      if (!current || !/^\s*18\b/.test(current)) {
        await nameBox.fill(RELEASE_NAME);
        console.log(`✅ Release name set to "${RELEASE_NAME}".`);
      } else {
        console.log(`ℹ️  Release name left as: ${current}`);
      }
    }
  } catch {}
}

// ── Attached-bundle rows: NO-OP by design ──
// DOM inspection (2026-09-16) proved the Play Console prepare page exposes NO
// per-row delete control for attached bundles — rows carry only "View
// details" buttons (the ✕ seen in screenshots belongs to FAILED UPLOAD rows,
// not attached bundles). Play intentionally preloads the live release's
// bundle (17) into new drafts; a multi-bundle release is the standard Play
// pattern and devices always receive the highest versionCode (18). Removing
// rows is neither possible nor necessary.
async function removeStaleBundle(page) {
  return;
}

// ── Previous-release preload toggle ──
// The 2026 Play Console preloads the live release's bundle into new drafts via
// the "Previous release → Include app versions from your previous release"
// toggle (state label "Included"). A release containing both 17 (preloaded)
// and 18 fails validation ("completely shadowed"), and attached-bundle rows
// have NO per-row remove control — so the toggle is the ONLY way to drop 17.
async function excludePreviousRelease(page) {
  const rowVisible = await isVisible(page, /17 \(1\.0\.0\)/, 4000);
  if (!rowVisible) return true; // nothing listed at all
  // Per-row include/exclude toggle button (aria-label flips Include<->Exclude).
  // The row stays LISTED even when excluded, so the button state — not the
  // row text — is the source of truth.
  const excludeBtn = page.getByRole('button', { name: /^exclude$/i });
  if (
    await excludeBtn
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await excludeBtn
      .first()
      .click()
      .catch(() => {});
    await wait(4000);
    await clickVisible(
      page,
      'exclude confirm dialog (if any)',
      [
        (p) =>
          p
            .locator('[role="dialog"]')
            .getByRole('button', { name: /(remove|exclude|confirm|yes|ok)/i }),
      ],
      4000,
    );
    await wait(3000);
  }
  const stillIncluded = await excludeBtn
    .first()
    .isVisible()
    .catch(() => false);
  return !stillIncluded;
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
    const hit = await clickVisible(
      page,
      `developer account "${label}"`,
      [(p) => p.getByText(label, { exact: true })],
      20000,
    );
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
  const openedApp = await clickVisible(
    page,
    'TimeTrack app row',
    [
      (p) => p.getByText('TimeTrack: Workforce'),
      (p) => p.locator('a').filter({ hasText: /TimeTrack/i }),
    ],
    30000,
  );
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
    .goto(`https://play.google.com/console/u/0/developers/${devId}/app/${appId}/closed-testing`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    .catch(() => {});
  await wait(6000);
  await shot(page, 'closed-testing-list');

  // The tracks list shows a "Closed testing - Alpha" card whose right side
  // carries a "Manage track" link that opens the release page.
  let entered = await clickVisible(
    page,
    '"Manage track" link (Alpha row)',
    [
      (p) => p.getByRole('link', { name: /manage track/i }),
      (p) => p.getByText('Manage track', { exact: true }),
    ],
    20000,
  );
  if (entered) await wait(5000);

  if (!/releases|track\//.test(page.url())) {
    // Fallback: click the track title itself.
    entered = await clickVisible(
      page,
      '"Closed testing - Alpha" title',
      [
        (p) => p.getByText('Closed testing - Alpha', { exact: true }),
        (p) => p.getByText(/Closed testing\s*-\s*Alpha/i),
        (p) => p.getByText('Alpha', { exact: true }),
      ],
      15000,
    );
    if (entered) await wait(5000);
  }

  const url = page.url();
  if (!/closed-testing|alpha|releases/.test(url)) {
    await shot(page, 'not-on-alpha-track');
  }
  await shot(page, 'alpha-track-page');

  // ── Detect current track state ──
  const hasVc17 = await isVisible(page, /18 \(1\.0\.0\)/, 6000);
  const hasDraft =
    (await isVisible(page, /edit release/i, 5000)) ||
    (await isVisible(page, /^\s*Untitled release\s*$/i, 4000)) ||
    (await isVisible(page, /\bDraft\b/, 4000));
  const alreadyLive = await isVisible(
    page,
    /rollout started|in review|review in progress|available to (selected )?testers|fully live|staged rollout/i,
    6000,
  );
  console.log(
    `ℹ️  track state: hasVc17=${hasVc17} hasDraft=${hasDraft} hasLiveRelease16=${await isVisible(page, /17 \(1\.0\.0\)/, 4000)}`,
  );

  let submitted = false;

  if (hasVc17 && alreadyLive && !hasDraft) {
    console.log('ℹ️  Closed "alpha" already carries Release 18 (1.0.0) — nothing to do.');
    submitted = true;
  } else {
    // Enter the release editor: via the existing draft, or by creating one.
    let inEditor = false;
    if (hasDraft) {
      console.log('📝 Draft exists on closed "alpha" — opening its editor.');
      inEditor = await clickVisible(
        page,
        '"Edit release" (draft editor)',
        [
          (p) => p.getByRole('link', { name: /edit release/i }),
          (p) => p.getByText('Edit release', { exact: true }),
          (p) => p.getByRole('button', { name: /edit release/i }),
        ],
        20000,
      );
    } else {
      console.log('➕ Creating a new release on closed "alpha"...');
      inEditor = await clickVisible(
        page,
        '"Create new release" (closed alpha)',
        [
          (p) => p.getByRole('button', { name: /create new release/i }),
          (p) => p.getByText('Create new release', { exact: true }),
        ],
        30000,
      );
    }
    if (inEditor) {
      await wait(6000);
      await shot(page, 'release-editor');

      // ── Shadowed-bundle recovery (verified 2026-09-16) ──
      // Play preloads the live release's bundle (17) into new drafts and the
      // 2026 Console offers NO control to remove it; a release containing
      // 17+18 fails validation ("completely shadowed … remove this APK").
      // Recovery: discard this draft, HALT the live release 17 (its review
      // page carries "Halt rollout"), then create a fresh draft that no
      // longer preloads anything.
      const preloaded = await isVisible(page, /17 \(1\.0\.0\)/, 5000);
      if (preloaded) {
        console.log('ℹ️  Live bundle 17 preloaded into the draft — excluding via toggle.');
        // The 2026 Console surfaces the preload as a "Previous release →
        // Included" toggle in the App bundles section. Switch it off to drop
        // bundle 17 from this draft (no halt/pause needed).
        const excluded = await excludePreviousRelease(page);
        if (excluded) {
          console.log('✅ Previous release bundle 17 excluded from this draft.');
          await shot(page, 'excluded-17');
        } else {
          console.log('⚠️  Could not exclude previous release bundle 17 — aborting to GUIDED.');
          await shot(page, 'exclude-failed');
          console.log('PLAY_CONSOLE_RESULT: GUIDED');
          await wait(5000);
          await context.close();
          return;
        }
      }

      // NOTE (verified via DOM inspection 2026-09-16): Play PRELOADS the live
      // release's bundle (17) into every new draft — that is by design, not
      // dirt. A multi-bundle release is the standard Play pattern and devices
      // always receive the highest versionCode (18). Only a FAILED upload row
      // ("…associated with the upload was deleted. Please retry.") makes a
      // draft dirty enough to discard.
      const dirty = await isVisible(
        page,
        /associated with the upload was deleted|please retry/i,
        3000,
      );
      if (dirty) {
        console.log('ℹ️  Draft is dirty (wrong-version bundle / failed upload) — discarding it...');
        await page.keyboard.press('Escape').catch(() => {});
        await wait(1000);
        const discarded = await clickVisible(
          page,
          '"Discard draft release"',
          [
            (p) => p.getByText('Discard draft release', { exact: true }),
            (p) => p.getByRole('link', { name: /discard draft release/i }),
            (p) => p.getByRole('button', { name: /discard draft release/i }),
          ],
          10000,
        );
        if (discarded) {
          await wait(3000);
          await clickVisible(
            page,
            'discard confirm dialog',
            [(p) => p.getByRole('button', { name: /^(discard|delete|confirm|yes)$/i })],
            8000,
          );
          await wait(6000);
          const created = await clickVisible(
            page,
            '"Create new release" (after discard)',
            [
              (p) => p.getByRole('button', { name: /create new release/i }),
              (p) => p.getByText('Create new release', { exact: true }),
            ],
            30000,
          );
          if (created) {
            await wait(6000);
            await shot(page, 'fresh-editor');
          }
        }
      }

      // Remove the previous release's (vc16) bundle row if the editor preloaded it.
      await removeStaleBundle(page);

      // Skip bundling if the editor already shows vc18 attached.
      const bundleAlready = await isVisible(page, /18 \(1\.0\.0\)/, 5000);
      if (bundleAlready) {
        console.log('ℹ️  vc18 already attached to this release.');
      } else {
        await attachBundleVc17(page);
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
      15000,
    );
    for (let i = 0; i < 12 && !done; i++) {
      await wait(10000);
      done = await isVisible(
        page,
        /rollout started|in review|review in progress|ready to send|fully live|staged rollout/i,
        5000,
      );
    }
  }
  await shot(page, 'final');

  if (done) {
    console.log('✅ Release 18 (1.0.0) rollout submitted on closed testing "alpha".');
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
    console.log('      (or pick Release 18 from the app bundle library)');
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
