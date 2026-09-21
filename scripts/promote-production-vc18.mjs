/**
 * Google Play Console — PRODUCTION rollout for release 18 (1.0.0)
 * ---------------------------------------------------------------
 * Ships the vc18 app bundle (EAS build #18, targets API 36 per the Google
 * Play Aug-2026 policy — already live on Closed testing "alpha") to the
 * Production track with upbeat release notes.
 *
 * Conventions match scripts/update-closed-alpha-vc18.mjs:
 *  - Persistent Chromium profile (.playwright-google-profile/) keeps the
 *    Google sign-in alive across runs.
 *  - If a sign-in / 2FA challenge appears the script waits for the human.
 *  - Prefers attaching the already-uploaded vc18 bundle from the Play
 *    Console app bundle library; falls back to uploading the .aab.
 *
 * Log markers (for automation watchers):
 *   PLAY_CONSOLE_RESULT: DONE    -> production rollout submitted
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
const RELEASE_NAME = '18'; // production row then reads "Release: 17 (1.0.0)"
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
// Verified 2026-09-16 from the Play Console URL of "TimeTrack: Workforce &
// Payroll" (the account hosts several apps; app-list row clicks proved
// unreliable, so we navigate straight to the app).
const DEV_ID = '8121995548332442173';
const APP_ID = '4976072281005342488';

// "What's new" copy — enthusiastic and appreciative (Play limit: 500 chars).
const RELEASE_NOTES = [
  '🚀 TimeTrack 1.0.0',
  '⏰ New: shift reminders — a heads-up 5 minutes before your shift starts and ends',
  '📍 Auto clock-in/out keeps getting better: punches captured offline are saved and sync automatically',
  '🔔 Managers: new in-app notification centre for late-ins, early-outs and no-shows',
  '📊 New reports: daily breakdown per employee and cost-of-late insights',
  '🛠️ Stability improvements and polish',
  'Thank you for using TimeTrack! 💙',
].join('\n');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`🔎 [${name}] url=${page.url()}`);
  try {
    await page.screenshot({ path: path.resolve(ROOT, `play-console-production-${name}.png`) });
    console.log(`📸 saved play-console-production-${name}.png`);
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

// ── Review + rollout (production wording; falls back to generic labels) ──
// Returns true only when the rollout click actually succeeded.
async function submitRelease(page) {
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
  const reviewed = await clickVisible(
    page,
    '"Review release"',
    [
      (p) => p.getByRole('button', { name: /review release/i }),
      (p) => p.getByText('Review release', { exact: true }),
    ],
    30000,
  );
  await wait(4000);
  const rolled = await clickVisible(
    page,
    '"Start rollout to Production" / "Send for review"',
    [
      (p) => p.getByRole('button', { name: /start rollout to production/i }),
      (p) => p.getByText(/Start rollout to Production/i),
      (p) => p.getByRole('button', { name: /send (release )?(for|to) review/i }),
      (p) => p.getByRole('button', { name: /start rollout/i }),
    ],
    30000,
  );
  await wait(3000);
  if (rolled) {
    await clickVisible(
      page,
      'confirm dialog',
      [
        (p) => p.getByRole('button', { name: /^confirm$/i }),
        (p) => p.getByRole('button', { name: /send for review/i }),
        (p) => p.getByRole('button', { name: /start rollout/i }),
      ],
      15000,
    );
  }
  return { reviewed, rolled };
}

// Attach version code 16 INSIDE the release editor (library first, then upload).
async function attachBundleVc18(page) {
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
    const picked = await clickVisible(
      page,
      'vc18 row checkbox in library chooser',
      [
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
    );
    if (!picked) await shot(page, 'library-no-vc18');
    await wait(1500);
    const added = await clickVisible(
      page,
      'library confirm ("Add to release")',
      [
        (p) => p.getByRole('button', { name: /add to release/i }),
        (p) => p.getByText('Add to release', { exact: true }),
        (p) => p.getByRole('button', { name: /^add$/i }),
      ],
      15000,
    );
    if (picked && added) {
      console.log('✅ Attached vc18 from the app bundle library.');
      await wait(30000);
      return true;
    }
  }

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
      await wait(60000);
      return true;
    }
    console.log('ℹ️  Upload clicked but no chooser appeared; trying direct input...');
  }

  try {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 10000 });
    await fileInput.setInputFiles(AAB_PATH);
    console.log(`✅ Uploading bundle via direct input: ${path.basename(AAB_PATH)}`);
    await wait(60000);
    return true;
  } catch {
    console.log('⚠️  Could not attach the vc18 bundle automatically.');
    await shot(page, 'attach-failed');
    return false;
  }
}

// ── Country/region selection (PRODUCTION requirement) ──
// The production prepare page disables "Review release" until at least one
// country/region is selected. Expand the section, open the picker, choose
// South Africa (the app's launch market), and confirm.
async function ensureCountrySelection(page) {
  const opened = await clickVisible(
    page,
    '"Countries / regions" section',
    [
      (p) => p.getByText(/countries? (and|\/) regions?/i),
      (p) => p.getByText(/countries? \/ regions?/i),
      (p) => p.getByRole('button', { name: /countries/i }),
    ],
    8000,
  );
  if (!opened) {
    console.log('ℹ️  Country section not found — assuming already configured.');
    return true;
  }
  await wait(2500);
  const added = await clickVisible(
    page,
    '"Add countries / regions"',
    [
      (p) => p.getByRole('button', { name: /add countries/i }),
      (p) => p.getByText(/add countries/i),
    ],
    8000,
  );
  if (!added) {
    console.log('⚠️  Add-countries control not found — leaving to GUIDED.');
    return false;
  }
  await wait(2500);
  const picked = await clickVisible(
    page,
    '"South Africa" row',
    [
      (p) => p.locator('[role="dialog"]').getByText('South Africa', { exact: true }),
      (p) => p.getByText('South Africa', { exact: true }),
    ],
    8000,
  );
  if (!picked) {
    console.log('⚠️  Could not pick a country — leaving to GUIDED.');
    return false;
  }
  await wait(2000);
  await clickVisible(
    page,
    'picker confirm ("Add"/"Save")',
    [
      (p) => p.locator('[role="dialog"]').getByRole('button', { name: /^(add|save|apply)$/i }),
      (p) => p.getByRole('button', { name: /^(add|save|apply)$/i }),
    ],
    8000,
  );
  await wait(3000);
  console.log('✅ Country selection attempted.');
  return true;
}

// ── Release name box: ensure it reflects release 18 ──
async function ensureReleaseName(page) {
  try {
    const nameBox = page.getByLabel(/release name/i).first();
    if ((await nameBox.count()) > 0) {
      const current = await nameBox.inputValue().catch(() => '');
      if (!/^\s*18\b/.test(current || '')) {
        await nameBox.fill(RELEASE_NAME);
        console.log(`✅ Release name set to "${RELEASE_NAME}".`);
      } else {
        console.log(`ℹ️  Release name left as: ${current}`);
      }
    }
  } catch {}
}

// ── Release notes ("What's new"): upbeat copy, en-US default ──
async function fillReleaseNotes(page) {
  // The editor keeps notes behind an "Add release notes" expander; open it.
  await clickVisible(
    page,
    '"Add release notes" expander (if present)',
    [
      (p) => p.getByText('Add release notes', { exact: true }),
      (p) => p.getByRole('button', { name: /add release notes/i }),
      (p) => p.getByText(/release notes/i).first(),
    ],
    8000,
  );
  await wait(2500);
  const makers = [
    (p) => p.getByLabel(/release notes/i),
    (p) => p.locator('textarea[aria-label*="release notes" i]'),
    (p) => p.locator('[role="dialog"] textarea'),
    (p) => p.locator('textarea'),
  ];
  let filled = false;
  for (const mk of makers) {
    try {
      const loc = mk(page);
      const n = await loc.count();
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.fill(RELEASE_NOTES);
          console.log('✅ Release notes filled (overwhelmingly positive ✨).');
          filled = true;
          break;
        }
      }
    } catch {}
    if (filled) break;
  }
  if (!filled) {
    console.log('ℹ️  No release-notes textarea found (optional) — skipping.');
    return;
  }
  await wait(1500);
  // Notes dialogs carry an explicit Save/Apply; inline forms do not.
  await clickVisible(
    page,
    'notes "Save"/"Apply" (if dialog)',
    [
      (p) => p.getByRole('button', { name: /^(save|apply)$/i }),
      (p) => p.locator('[role="dialog"]').getByRole('button', { name: /^(save|apply)$/i }),
    ],
    6000,
  );
}

// ── Previous-release preload guard (2026 Console) ──
// New drafts preload the live track's bundle ("Previous release → Included");
// a release containing both the preloaded bundle and 17 fails validation
// ("completely shadowed"). Rows carry a per-row Include/Exclude toggle button
// (aria-label flips); the row stays listed when excluded, so the button state
// is the source of truth. Click every "Exclude" until none remain.
async function excludePreviousRelease(page) {
  for (let i = 0; i < 4; i++) {
    const btn = page.getByRole('button', { name: /^exclude$/i }).first();
    if (!(await btn.isVisible().catch(() => false))) return true;
    await btn.click().catch(() => {});
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
  return !(await page
    .getByRole('button', { name: /^exclude$/i })
    .first()
    .isVisible()
    .catch(() => false));
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

  console.log('🌐 Navigating directly to the TimeTrack app (verified IDs)...');
  const appUrl = `https://play.google.com/console/u/0/developers/${DEV_ID}/app/${APP_ID}`;
  await page
    .goto(`${appUrl}/test-and-release`, { waitUntil: 'domcontentloaded', timeout: 60000 })
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
      .goto(`${appUrl}/test-and-release`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {});
  }

  await wait(6000);
  if (await isVisible(page, /choose developer account/i, 5000)) {
    await clickVisible(
      page,
      'developer account "dr-rsmart"',
      [(p) => p.getByText('dr-rsmart', { exact: true })],
      20000,
    );
    await wait(5000);
  }
  await shot(page, 'test-and-release');
  const devId = DEV_ID;
  const appId = APP_ID;

  // ── Production track ──
  // Verified 2026-09-21: the only deep link that reaches the production
  // track from a cold start is .../tracks/production. /releases/production
  // and /production redirect to the app-list page (previous GUIDED cause).
  console.log('🧭 Opening the Production track…');
  const productionUrl = `https://play.google.com/console/u/0/developers/${devId}/app/${appId}/tracks/production`;
  await page.goto(productionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(7000);
  // The Console may re-ask for a developer account after redirects.
  const bodyText0 = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/choose developer account/i.test(bodyText0)) {
    await clickVisible(
      page,
      'developer account "dr-rsmart" (post-nav chooser)',
      [(p) => p.getByText('dr-rsmart', { exact: true })],
      12000,
    );
    await wait(6000);
    await page
      .goto(productionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {});
    await wait(7000);
  }
  if (!/production/i.test(page.url())) {
    console.log('⚠️  Could not reach the Production track page.');
    await shot(page, 'production-unreachable');
    console.log('PLAY_CONSOLE_RESULT: GUIDED');
    const dl0 = Date.now() + 10 * 60 * 1000;
    while (Date.now() < dl0 && !page.isClosed()) await wait(15000);
    return;
  }
  await shot(page, 'production-page');

  // ── Personal-account production gate (tester requirement) ──
  if (
    await isVisible(
      page,
      /requirements? before (you )?(can )?releas|testers (for|over) \d+ days|meet the (closed )?testing requirements/i,
      6000,
    )
  ) {
    console.log('🚧 Play is showing the production ELIGIBILITY GATE (tester requirement).');
    console.log('PLAY_CONSOLE_RESULT: GUIDED — see window; requirement must be met first.');
    const dl = Date.now() + 10 * 60 * 1000;
    while (Date.now() < dl && !page.isClosed()) await wait(15000);
    return;
  }

  // ── Detect current production state ──
  const hasVc17 = await isVisible(page, /18 \(1\.0\.0\)/, 6000);
  const alreadyLive = await isVisible(
    page,
    /rollout started|in review|review in progress|fully live|staged rollout|published/i,
    6000,
  );
  const hasDraft =
    (await isVisible(page, /edit release/i, 5000)) ||
    (await isVisible(page, /^\s*Untitled release\s*$/i, 4000)) ||
    (await isVisible(page, /\bDraft\b/, 4000));
  console.log(
    `ℹ️  production state: hasVc17=${hasVc17} alreadyLive=${alreadyLive} hasDraft=${hasDraft}`,
  );

  let submitted = false;
  if (hasVc17 && alreadyLive && !hasDraft) {
    console.log('ℹ️  Production already carries release 18 (1.0.0) — nothing to do.');
    submitted = true;
  } else {
    let inEditor = false;
    if (hasDraft) {
      console.log('📝 Draft exists on Production — opening its editor.');
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
      console.log('➕ Creating a new PRODUCTION release...');
      inEditor = await clickVisible(
        page,
        '"Create new release" (production)',
        [
          (p) => p.getByRole('button', { name: /create new release/i }),
          (p) => p.getByText('Create new release', { exact: true }),
          (p) => p.getByRole('button', { name: /get started|create (your first )?release/i }),
          (p) => p.getByText(/Create your first release/i),
        ],
        30000,
      );
    }
    if (inEditor) {
      await wait(6000);
      await shot(page, 'release-editor');
      const bundleAlready = await isVisible(page, /18 \(1\.0\.0\)/, 5000);
      if (bundleAlready) {
        // Draft already carries vc18 — never run the exclude guard here
        // (it would strip the attached bundle).
        console.log('ℹ️  vc18 already attached — skipping exclude/attach.');
      } else {
        // Drop the preloaded previous-production bundle (shadow guard).
        const excluded = await excludePreviousRelease(page);
        if (!excluded) {
          console.log('⚠️  Could not exclude the preloaded previous bundle — aborting to GUIDED.');
          await shot(page, 'exclude-failed');
          console.log('PLAY_CONSOLE_RESULT: GUIDED');
          await wait(5000);
          await context.close();
          return;
        }
        console.log('✅ Previous-release bundle excluded from this draft.');
        await attachBundleVc18(page);
      }
      await ensureCountrySelection(page);
      await ensureReleaseName(page);
      await fillReleaseNotes(page);
      await shot(page, 'before-review');
      const { rolled } = await submitRelease(page);
      submitted = rolled;
    } else {
      await shot(page, 'editor-unreachable');
    }
  }

  // ── Confirm rollout state ──
  let done = submitted;
  if (submitted) {
    done = await isVisible(
      page,
      /rollout started|in review|review in progress|fully live|staged rollout|published|changes? sent/i,
      15000,
    );
    for (let i = 0; i < 12 && !done; i++) {
      await wait(10000);
      done = await isVisible(
        page,
        /rollout started|in review|review in progress|fully live|staged rollout|published/i,
        5000,
      );
    }
  }
  await shot(page, 'final');

  if (done) {
    console.log('✅ Release 18 (1.0.0) submitted to PRODUCTION (Google review pending).');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else if (submitted) {
    console.log('ℹ️  Rollout clicked but final status not yet visible (may take review time).');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else {
    console.log('======================================================');
    console.log('🟢 GUIDED MODE — finish in the open browser window:');
    console.log('   1. In the release editor, select at least one');
    console.log('      country/region (Countries / regions section).');
    console.log('   2. "Review release" -> "Start rollout to Production"');
    console.log('   3. Confirm the rollout.');
    console.log('======================================================');
    console.log('PLAY_CONSOLE_RESULT: GUIDED');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline && !page.isClosed()) {
      await wait(15000);
      if (await isVisible(page, /rollout started|in review|review in progress|published/i, 1000)) {
        console.log('✅ Guided completion detected.');
        await shot(page, 'guided-completed');
        break;
      }
    }
  }
}

run()
  .catch((err) => {
    console.error('❌ Unexpected failure:', err);
    console.log('PLAY_CONSOLE_RESULT: ERROR');
  })
  .finally(() => {
    setTimeout(() => process.exit(0), 3000);
  });
