/**
 * confirm-play-submit.mjs
 * ------------------------
 * Final submission step with corrected confirm-dialog selectors.
 * On the Publishing overview: click "Submit N changes for review", then
 * confirm in the dialog ("Submit N changes for review" / "Send N changes
 * for review" / "Confirm") and wait for the in-review state.
 * (The older submit-publishing-vc18.mjs confirm list missed the modern
 * "Submit 3 changes for review" dialog label — regex required the words
 * "submit for review" to be adjacent.)
 *
 * Log markers: PLAY_CONSOLE_RESULT: DONE | GUIDED | ERROR
 */
import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const DEV = '8121995548332442173';
const APP = '4976072281005342488';
const PUBLISHING_URL = `https://play.google.com/console/u/0/developers/${DEV}/app/${APP}/publishing`;

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
      path: path.resolve(ROOT, `play-console-privacy-${name}.png`),
      fullPage: true,
    });
    console.log(`📸 saved play-console-privacy-${name}.png`);
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

  await goto(PUBLISHING_URL);
  if (page.url().includes('accounts.google.com')) {
    console.log('🔐 SIGN-IN REQUIRED — complete it in the opened window.');
    const dl = Date.now() + 4 * 60 * 1000;
    while (Date.now() < dl && !page.isClosed() && !page.url().includes('play.google.com')) {
      await wait(5000);
    }
  }
  await wait(6000);
  let bodyText = await page
    .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
    .catch(() => '');
  if (/choose developer account/i.test(bodyText)) {
    await clickVisible(
      page,
      'developer account "dr-rsmart"',
      [(p) => p.getByText('dr-rsmart', { exact: true })],
      12000,
    );
    await wait(6000);
    await goto(PUBLISHING_URL);
    await wait(6000);
    bodyText = await page
      .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      .catch(() => '');
  }
  await shot(page, 'submit-overview');
  console.log('TEXT SLICE: ' + bodyText.slice(0, 900));

  // Already in review?
  if (/in review|review in progress|changes? sent for review/i.test(bodyText)) {
    console.log('✅ Changes already sent for review.');
    console.log('PLAY_CONSOLE_RESULT: DONE');
    await context.close().catch(() => {});
    return;
  }

  // ── Submit button (only if changes are pending) ──
  const hasPending = /submit \d+ changes? for review/i.test(bodyText);
  if (hasPending) {
    await clickVisible(
      page,
      '"Submit N changes for review"',
      [
        (p) => p.getByRole('button', { name: /submit \d+ changes? for review/i }),
        (p) => p.getByText(/submit \d+ changes? for review/i),
      ],
      20000,
    );
    await wait(3000);
    // ── Confirmation dialog (corrected selectors) ──
    await clickVisible(
      page,
      'confirm dialog',
      [
        (p) => p.getByRole('button', { name: /submit \d+ changes? for review/i }),
        (p) => p.getByRole('button', { name: /send \d+ changes? for review/i }),
        (p) => p.getByRole('button', { name: /^confirm$/i }),
        (p) => p.getByRole('button', { name: /confirm and submit/i }),
        (p) => p.getByRole('button', { name: /submit for review/i }),
        (p) => p.getByRole('button', { name: /^yes$/i }),
      ],
      20000,
    );
  }

  let done = await isVisible(page, /in review|review in progress|changes? sent for review/i, 15000);
  for (let i = 0; i < 10 && !done; i++) {
    await wait(10000);
    done = await isVisible(page, /in review|review in progress|changes? sent for review/i, 5000);
  }
  await shot(page, 'submit-final');

  if (done) {
    console.log('✅ Changes submitted for review — Google review in progress.');
    console.log('PLAY_CONSOLE_RESULT: DONE');
    await context.close().catch(() => {});
    return;
  }
  console.log('🟢 GUIDED MODE — confirm the submission in the opened window.');
  console.log('PLAY_CONSOLE_RESULT: GUIDED');
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline && !page.isClosed()) {
    await wait(15000);
    if (await isVisible(page, /in review|review in progress|changes? sent for review/i, 1000)) {
      console.log('✅ Guided completion detected.');
      await shot(page, 'guided-completed');
      break;
    }
  }
  await context.close().catch(() => {});
}

run().catch((e) => {
  console.error('PLAY_CONSOLE_RESULT: ERROR —', e);
  process.exitCode = 1;
});
