/**
 * finish-production-vc18.mjs
 * --------------------------
 * Completes the ALREADY-SAVED production draft ("Release 18 (1.0.0)", vc18
 * bundle attached, notes filled) by driving the final steps:
 *   Review release -> Start rollout to Production -> Confirm.
 *
 * Opens the draft editor directly via its verified SPA URL
 *   .../tracks/4697265543315267718/releases/1/prepare
 * so no row-click discovery is needed. Adds a country only when the draft
 * shows none (the saved draft already has "1 country / region").
 *
 * Log markers:
 *   PLAY_CONSOLE_RESULT: DONE    -> rollout submitted
 *   PLAY_CONSOLE_RESULT: GUIDED  -> window left open for manual completion
 *   PLAY_CONSOLE_RESULT: ERROR   -> unexpected failure
 */
import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const DEV = '8121995548332442173';
const APP = '4976072281005342488';
const TRACK = '4697265543315267718'; // production track (probe-verified)
const DRAFT_URL = `https://play.google.com/console/u/0/developers/${DEV}/app/${APP}/tracks/${TRACK}/releases/1/prepare`;

setTimeout(
  () => {
    console.log('PLAY_CONSOLE_RESULT: TIMEOUT');
    process.exit(2);
  },
  8 * 60 * 1000,
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`🔎 [${name}] url=${page.url()}`);
  try {
    await page.screenshot({
      path: path.resolve(ROOT, `play-console-production-${name}.png`),
      fullPage: true,
    });
    console.log(`📸 saved play-console-production-${name}.png`);
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

// ── Conditional country selection (only when the draft has none) ──
async function ensureCountrySelection(page) {
  const hasCountries = await isVisible(
    page,
    /\d+ countries?|\d+ country \/ region|South Africa/i,
    5000,
  );
  if (hasCountries) {
    console.log('ℹ️  Country/region already selected — skipping.');
    return true;
  }
  const opened = await clickVisible(
    page,
    '"Countries / regions" section',
    [
      (p) => p.getByText(/countries? (and|\/) regions?/i),
      (p) => p.getByText(/countries? \/ regions?/i),
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
    console.log('⚠️  Add-countries control not found.');
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
    console.log('⚠️  Could not pick a country.');
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

// ── Review + rollout ──
async function reviewAndRollout(page) {
  // Save the draft state first (idempotent), then review.
  await clickVisible(
    page,
    '"Save" (draft)',
    [
      (p) => p.getByRole('button', { name: /^save$/i }),
      (p) => p.getByText('Save', { exact: true }),
    ],
    15000,
  );
  await wait(4000);
  const reviewed = await clickVisible(
    page,
    '"Review release"',
    [
      (p) => p.getByRole('button', { name: /review release/i }),
      (p) => p.getByText('Review release', { exact: true }),
    ],
    30000,
  );
  if (!reviewed) {
    // 2026 UI sometimes uses a bottom-bar "Next" to leave prepare.
    const next = await clickVisible(
      page,
      '"Next" (prepare -> review)',
      [
        (p) => p.getByRole('button', { name: /^next$/i }),
        (p) => p.getByText('Next', { exact: true }),
      ],
      20000,
    );
    if (!next) return false;
    await wait(5000);
  }
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
  if (!rolled) return false;
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
  return true;
}

async function run() {
  console.log('🚀 Launching visible Chromium with persistent Google profile…');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = context.pages()[0] || (await context.newPage());

  const goto = async (url) => {
    console.log(`🌐 goto ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      console.log(`⚠️ goto failed: ${String(e).slice(0, 120)}`);
    }
  };

  await goto(`https://play.google.com/console/u/0/developers/${DEV}/app/${APP}/test-and-release`);
  if (page.url().includes('accounts.google.com')) {
    console.log('🔐 SIGN-IN REQUIRED — complete it in the opened window.');
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline && !page.isClosed() && !page.url().includes('play.google.com')) {
      await wait(5000);
    }
  }
  await wait(5000);
  try {
    await page.getByText('dr-rsmart', { exact: true }).first().click({ timeout: 12000 });
    await wait(5000);
  } catch {}

  // Open the saved draft editor directly (verified SPA URL).
  await goto(DRAFT_URL);
  await wait(7000);
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/choose developer account/i.test(bodyText)) {
    await clickVisible(
      page,
      'developer account "dr-rsmart"',
      [(p) => p.getByText('dr-rsmart', { exact: true })],
      12000,
    );
    await wait(6000);
    await goto(DRAFT_URL);
    await wait(7000);
  }
  await shot(page, 'draft-editor');
  console.log('TEXT SLICE: ' + bodyText.slice(0, 1200));

  const countryOk = await ensureCountrySelection(page);
  const rolled = await reviewAndRollout(page);

  let done = rolled;
  if (rolled) {
    done = await isVisible(
      page,
      /rollout started|in review|review in progress|changes? sent|published/i,
      15000,
    );
    for (let i = 0; i < 10 && !done; i++) {
      await wait(10000);
      done = await isVisible(page, /rollout started|in review|review in progress|published/i, 5000);
    }
  }
  await shot(page, 'final');

  if (done) {
    console.log('✅ Release 18 (1.0.0) rollout submitted to PRODUCTION.');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else {
    console.log('======================================================');
    console.log('🟢 GUIDED MODE — finish in the open browser window:');
    if (!countryOk) console.log('   1. Add at least one country/region in the editor.');
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
  await context.close().catch(() => {});
}

run().catch((e) => {
  console.error('PLAY_CONSOLE_RESULT: ERROR —', e);
  process.exitCode = 1;
});
