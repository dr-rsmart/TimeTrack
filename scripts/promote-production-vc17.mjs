/**
 * Google Play Console — PRODUCTION rollout for release 17 (1.0.0)
 * ---------------------------------------------------------------
 * Ships the vc17 app bundle (EAS build #17, targets API 36 per the Google
 * Play Aug-2026 policy — already live on Closed testing "alpha") to the
 * Production track with upbeat release notes.
 *
 * Conventions match scripts/update-closed-alpha-vc17.mjs:
 *  - Persistent Chromium profile (.playwright-google-profile/) keeps the
 *    Google sign-in alive across runs.
 *  - If a sign-in / 2FA challenge appears the script waits for the human.
 *  - Prefers attaching the already-uploaded vc17 bundle from the Play
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
const AAB_PATH = path.resolve(ROOT, 'timetrack-vc17.aab');
const RELEASE_NAME = '17'; // production row then reads "Release: 17 (1.0.0)"
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
// Verified 2026-09-16 from the Play Console URL of "TimeTrack: Workforce &
// Payroll" (the account hosts several apps; app-list row clicks proved
// unreliable, so we navigate straight to the app).
const DEV_ID = '8121995548332442173';
const APP_ID = '4976072281005342488';

// "What's new" copy — enthusiastic and appreciative (Play limit: 500 chars).
const RELEASE_NOTES = [
  '🚀 TimeTrack 1.0.0 — Release 17',
  '📍 Auto clock-in/out is now hybrid: attendance punches automatically the moment you open TimeTrack on site',
  '🔒 Background clocking keeps working when the app is closed or the phone is locked',
  '👥 Switching accounts on a shared device now auto-clocks correctly',
  '🛠 Stability improvements and polish',
  'Thank you for your feedback — auto clocking just got even more reliable! 💙',
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

// Attach version code 16 INSIDE the release editor (library first, then upload).
async function attachBundleVc17(page) {
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
      'vc17 row checkbox in library chooser',
      [
        (p) =>
          p.locator(
            'xpath=(//*[normalize-space(text())="17"]/preceding::*[self::input[@type="checkbox"] or @role="checkbox"])[last()]',
          ),
        (p) =>
          p
            .locator('[role="dialog"] input[type="checkbox"], [role="dialog"] [role="checkbox"]')
            .nth(1),
        (p) =>
          p
            .locator('tr')
            .filter({ has: p.locator('td').filter({ hasText: /^17$/ }) })
            .getByRole('checkbox'),
        (p) =>
          p
            .locator('tr')
            .filter({ hasText: /App bundle\s+17\s+1\.0\.0/ })
            .getByRole('checkbox'),
      ],
      20000,
    );
    if (!picked) await shot(page, 'library-no-vc17');
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
      console.log('✅ Attached vc17 from the app bundle library.');
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
    console.log('⚠️  Could not attach the vc17 bundle automatically.');
    await shot(page, 'attach-failed');
    return false;
  }
}

// ── Release name box: ensure it reflects release 17 ──
async function ensureReleaseName(page) {
  try {
    const nameBox = page.getByLabel(/release name/i).first();
    if ((await nameBox.count()) > 0) {
      const current = await nameBox.inputValue().catch(() => '');
      if (!current || !/^\s*17\b/.test(current)) {
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
  console.log('🧭 Opening the Production section...');
  await page
    .goto(
      `https://play.google.com/console/u/0/developers/${devId}/app/${appId}/releases/production`,
      { waitUntil: 'domcontentloaded', timeout: 60000 },
    )
    .catch(() => {});
  await wait(6000);
  if (!/production/i.test(page.url())) {
    await page
      .goto(`https://play.google.com/console/u/0/developers/${devId}/app/${appId}/production`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      .catch(() => {});
    await wait(5000);
  }
  if (!/production/i.test(page.url())) {
    // Expand the "Test and release" nav group, then click its Production entry
    // (a bare text match can hit dashboard cards like "Latest production release").
    await clickVisible(
      page,
      '"Test and release" nav group',
      [(p) => p.getByText('Test and release', { exact: true })],
      10000,
    );
    await wait(2500);
    await clickVisible(
      page,
      '"Production" nav link',
      [
        (p) => p.locator('a').filter({ hasText: /^Production$/ }),
        (p) => p.getByRole('link', { name: /^production$/i }),
        (p) => p.getByRole('button', { name: /^production$/i }),
        (p) => p.getByText('Production', { exact: true }),
      ],
      20000,
    );
    await wait(5000);
  }
  if (!/production/i.test(page.url())) {
    // Last resort: read the Production nav anchor's href and navigate to it
    // directly (SPA clicks can land on dashboard cards with the same label).
    try {
      const href = await page
        .locator('a')
        .filter({ hasText: /^Production$/ })
        .first()
        .getAttribute('href', { timeout: 8000 });
      if (href) {
        const target = href.startsWith('http') ? href : `https://play.google.com/console${href}`;
        console.log(`🧭 Direct-navigating to Production href: ${target}`);
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await wait(6000);
      }
    } catch {}
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
  const hasVc17 = await isVisible(page, /17 \(1\.0\.0\)/, 6000);
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
    console.log('ℹ️  Production already carries release 17 (1.0.0) — nothing to do.');
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
      const bundleAlready = await isVisible(page, /17 \(1\.0\.0\)/, 5000);
      if (bundleAlready) {
        console.log('ℹ️  vc17 already attached to this release.');
      } else {
        await attachBundleVc17(page);
      }
      await ensureReleaseName(page);
      await fillReleaseNotes(page);
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
    console.log('✅ Release 17 (1.0.0) submitted to PRODUCTION (Google review pending).');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else if (submitted) {
    console.log('ℹ️  Rollout clicked but final status not yet visible (may take review time).');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else {
    console.log('======================================================');
    console.log('🟢 GUIDED MODE — finish in the open browser window:');
    console.log('   1. Releases -> Production -> "Create new release"');
    console.log('   2. Attach vc17 from the app bundle library (or upload');
    console.log(`      ${AAB_PATH})`);
    console.log(`   3. Release name: ${RELEASE_NAME}; add the positive release notes`);
    console.log('   4. "Review release" -> "Start rollout to Production" -> Confirm');
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
