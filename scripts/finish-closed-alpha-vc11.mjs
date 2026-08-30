/**
 * Google Play Console — finish the vc11 closed-alpha rollout
 * ----------------------------------------------------------
 * The vc11 draft release exists on Closed testing -> alpha with the
 * timetrack-vc11-multiloc.aab upload still being processed ("optimized for
 * distribution"), which leaves the editor's "Next" button disabled until
 * processing completes.
 *
 * This focused script:
 *  1) opens the draft editor,
 *  2) discards any duplicate-upload error state if present,
 *  3) re-attaches vc11 from the app bundle library ONLY if the bundle row is
 *     actually missing,
 *  4) completes Next -> Start rollout to Closed testing -> Confirm using
 *     actionability-aware clicks (waits up to 5 minutes for "Next" to enable).
 *
 * Log markers: FINISH11: DONE | FINISH11: GUIDED | FINISH11: ERROR
 */
import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname.endsWith('scripts') ? path.resolve(__dirname, '..') : __dirname;
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`🔎 [${name}] url=${page.url()}`);
  try {
    await page.screenshot({ path: path.resolve(ROOT, `play-console-finish11-${name}.png`) });
    console.log(`📸 saved play-console-finish11-${name}.png`);
  } catch {}
}

async function isVisible(page, rx, timeout = 8000) {
  try {
    await page.getByText(rx).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  console.log('🚀 Launching visible Chromium with persistent Google profile...');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = context.pages()[0] || (await context.newPage());

  if (await isVisible(page, /choose developer account/i, 8000)) {
    await page.getByText('dr-rsmart', { exact: true }).first().click().catch(() => {});
    await wait(5000);
  }

  // ── Open the closed alpha track (ids from prior probe runs) ──
  const devId = '8121995548332442173';
  const appId = '4976072281005342488';
  await page
    .goto(
      `https://play.google.com/console/u/0/developers/${devId}/app/${appId}/closed-testing`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    )
    .catch(() => {});
  await wait(6000);

  const manageMakers = [
    () => page.getByText('Manage track', { exact: true }).first(),
    () => page.getByRole('link', { name: /manage track/i }).first(),
    () => page.getByRole('button', { name: /manage track/i }).first(),
  ];
  let managed = false;
  for (let i = 0; i < 4 && !managed; i++) {
    for (const mk of manageMakers) {
      const loc = mk();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.click().catch(() => {});
        managed = true;
        break;
      }
    }
    if (!managed) await wait(5000);
  }
  await wait(5000);

  // ── Enter the draft editor (retry — console SPA renders slowly) ──
  const editMakers = [
    () => page.getByText('Edit release', { exact: true }).first(),
    () => page.getByRole('link', { name: /edit release/i }).first(),
    () => page.getByRole('button', { name: /edit release/i }).first(),
  ];
  let entered = false;
  for (let i = 0; i < 4 && !entered; i++) {
    for (const mk of editMakers) {
      const loc = mk();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.click().catch(() => {});
        entered = true;
        break;
      }
    }
    if (!entered) await wait(5000);
  }
  if (!entered) {
    await shot(page, 'no-draft-editor');
    console.log('FINISH8: GUIDED — no draft editor link found; finish manually.');
    await context.close();
    return;
  }
  await page.waitForURL(/releases\/\d+\/prepare/, { timeout: 30000 }).catch(() => {});
  await wait(6000);
  await shot(page, 'editor');

  // ── 1) Drop the duplicate-upload error state ──
  // The errored row may be SAVED in the draft (Discard disabled), so remove
  // the row itself via its X button; only fall back to Discard changes if
  // the console still offers it.
  if (await isVisible(page, /has already been used/i, 5000)) {
    console.log('ℹ️  Duplicate-upload error present — removing the errored row...');
    const makers = [
      () =>
        page.locator(
          'xpath=//*[contains(text(),"timetrack-vc8-webview-failsafe.aab")]/following::button[1]'
        ),
      () => page.getByRole('button', { name: /remove|dismiss|delete|close/i }).first(),
    ];
    for (const mk of makers) {
      if (!(await isVisible(page, /has already been used/i, 2000))) break;
      const btn = mk();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 8000 }).catch(() => {});
        await wait(4000);
      }
    }
    if (await isVisible(page, /has already been used/i, 2000)) {
      const discard = page.getByText('Discard changes', { exact: false }).first();
      await discard.click({ timeout: 8000 }).catch(() => {});
      await wait(4000);
    }
    await shot(page, 'after-remove');
  } else {
    console.log('ℹ️  No duplicate-upload error visible.');
  }

  // ── 2) Ensure the vc11 bundle row is present ──
  let hasBundle = await isVisible(page, /11 \(1\.0\.0\)/, 6000);
  if (!hasBundle) {
    hasBundle = await isVisible(page, /timetrack-vc11-multiloc\.aab/, 4000);
  }
  if (!hasBundle) {
    console.log('ℹ️  Bundle row missing — attaching vc11 from the app bundle library...');
    await page.getByText(/add from library/i).first().click().catch(() => {});
    await wait(4000);
    const row = page
      .locator('tr')
      .filter({ has: page.locator('td').filter({ hasText: /^11$/ }) })
      .first();
    if ((await row.count()) > 0) {
      await row.getByRole('checkbox').click().catch(() => row.click().catch(() => {}));
      await wait(1500);
      await page
        .getByRole('button', { name: /add to release|^add$/i })
        .first()
        .click()
        .catch(() => {});
      await wait(20000);
    }
    await shot(page, 'after-library');
  } else {
    console.log('✅ vc11 bundle row present in the draft.');
  }

  // ── 3) Next (actionability-aware: waits until enabled; the bundle can
  //        take several minutes to finish processing) ──
  const next = page.getByRole('button', { name: /^next$/i }).first();
  await next.click({ timeout: 300000 }).catch(async (e) => {
    console.log('⚠️  Next click failed:', e.message.split('\n')[0]);
    await shot(page, 'next-stuck');
  });
  await wait(6000);
  await shot(page, 'review-page');

  // A second Next may exist (notes / country pages)
  const next2 = page.getByRole('button', { name: /^next$/i }).first();
  if ((await next2.count()) > 0 && (await next2.isVisible().catch(() => false))) {
    await next2.click({ timeout: 15000 }).catch(() => {});
    await wait(4000);
  }

  // ── 4) Start rollout + confirm ──
  const rollout = page.getByRole('button', { name: /start rollout/i }).first();
  await rollout.click({ timeout: 30000 }).catch(async () => {
    await page
      .getByText(/start rollout to closed testing/i)
      .first()
      .click({ timeout: 10000 })
      .catch(() => {});
  });
  await wait(4000);
  const confirm2 = page.getByRole('button', { name: /^confirm$/i }).first();
  if ((await confirm2.count()) > 0) await confirm2.click().catch(() => {});
  await wait(6000);
  await shot(page, 'after-rollout');

  const done = await isVisible(
    page,
    /rollout started|in review|review in progress|available to (selected )?testers|staged rollout/i,
    20000
  );
  if (done) {
    console.log('✅ Release 11 rollout submitted on closed testing "alpha".');
    console.log('FINISH11: DONE');
  } else {
    console.log('FINISH11: GUIDED — complete the rollout in the open browser window.');
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline && !page.isClosed()) {
      await wait(15000);
      if (await isVisible(page, /rollout started|in review|review in progress/i, 1000)) {
        console.log('✅ Guided completion detected.');
        console.log('FINISH11: DONE');
        break;
      }
    }
  }
  await context.close();
}

run().catch((e) => {
  console.error('FINISH11: ERROR —', e);
  process.exitCode = 1;
});