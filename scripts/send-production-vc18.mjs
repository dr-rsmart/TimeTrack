/**
 * send-production-vc18.mjs
 * ------------------------
 * Correct final flow for the vc18 production release (learned 2026-09-21):
 * the review page (.../releases/1/review) carries Back + Save only, and the
 * help text states changes are "ready for you to send for review" from the
 * PUBLISHING OVERVIEW. So: Save -> Publishing overview -> Send for review ->
 * confirm.
 *
 * Log markers:
 *   PLAY_CONSOLE_RESULT: DONE | GUIDED | ERROR
 */
import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const DEV = '8121995548332442173';
const APP = '4976072281005342488';
const TRACK = '4697265543315267718';
const APP_BASE = `https://play.google.com/console/u/0/developers/${DEV}/app/${APP}`;
const REVIEW_URL = `${APP_BASE}/tracks/${TRACK}/releases/1/review`;

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

  await goto(`${APP_BASE}/test-and-release`);
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

  await goto(REVIEW_URL);
  await wait(7000);
  let bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/choose developer account/i.test(bodyText)) {
    await clickVisible(
      page,
      'developer account "dr-rsmart"',
      [(p) => p.getByText('dr-rsmart', { exact: true })],
      12000,
    );
    await wait(6000);
    await goto(REVIEW_URL);
    await wait(7000);
    bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
  }
  console.log('REVIEW URL: ' + page.url());
  await shot(page, 'review-page');

  // ── 1) Save the review step ──
  const saved = await clickVisible(
    page,
    '"Save" (review page)',
    [
      (p) => p.getByRole('button', { name: /^save$/i }),
      (p) => p.getByText('Save', { exact: true }),
    ],
    20000,
  );
  if (!saved) {
    console.log('🟢 GUIDED MODE — "Save" not found; finish manually in the window.');
    console.log('PLAY_CONSOLE_RESULT: GUIDED');
    const dl = Date.now() + 10 * 60 * 1000;
    while (Date.now() < dl && !page.isClosed()) await wait(15000);
    await context.close().catch(() => {});
    return;
  }
  await wait(8000);
  await shot(page, 'after-save');

  // ── 2) Send for review (may appear right after save, or on the overview) ──
  let sent = await clickVisible(
    page,
    '"Send for review" (inline)',
    [
      (p) => p.getByRole('button', { name: /send for review/i }),
      (p) => p.getByRole('button', { name: /start rollout/i }),
    ],
    15000,
  );
  if (!sent) {
    // Publishing overview: read its nav href and open it.
    try {
      const href = await page
        .evaluate(() => {
          const a = Array.from(document.querySelectorAll('a'))
            .map((el) => ({
              text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
              href: el.getAttribute('href') || '',
            }))
            .find((c) => c.text.includes('Publishing overview'));
          return a ? a.href : '';
        })
        .catch(() => '');
      if (href) {
        const target = href.startsWith('http') ? href : `https://play.google.com${href}`;
        console.log(`🧭 Publishing overview href: ${target}`);
        await goto(target);
        await wait(7000);
        await shot(page, 'publishing-overview');
        sent = await clickVisible(
          page,
          '"Send for review" (overview)',
          [
            (p) => p.getByRole('button', { name: /send for review/i }),
            (p) => p.getByText(/send for review/i),
            (p) => p.getByRole('button', { name: /review and send/i }),
            (p) => p.getByText(/review and send/i),
            (p) => p.getByRole('button', { name: /start rollout/i }),
            (p) => p.getByText(/start rollout to production/i),
          ],
          25000,
        );
      } else {
        console.log('⚠️  Publishing overview nav href not found.');
      }
    } catch (e) {
      console.log(`⚠️  overview navigation failed: ${String(e).slice(0, 100)}`);
    }
  }

  if (sent) {
    await wait(3000);
    await clickVisible(
      page,
      'confirm dialog',
      [
        (p) => p.getByRole('button', { name: /^confirm$/i }),
        (p) => p.getByRole('button', { name: /send for review/i }),
        (p) => p.getByRole('button', { name: /start rollout/i }),
        (p) => p.getByRole('button', { name: /^yes$/i }),
      ],
      15000,
    );
  }

  let done = false;
  if (sent) {
    done = await isVisible(
      page,
      /in review|review in progress|changes? sent|rollout started|published/i,
      15000,
    );
    for (let i = 0; i < 10 && !done; i++) {
      await wait(10000);
      done = await isVisible(page, /in review|review in progress|changes? sent|published/i, 5000);
    }
  }
  await shot(page, 'final');

  if (done) {
    console.log('✅ Release 18 (1.0.0) SENT FOR REVIEW to PRODUCTION.');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else {
    console.log('🟢 GUIDED MODE — finish in the open browser window:');
    console.log('   Save (if unsaved) -> Publishing overview -> Send for review -> Confirm.');
    console.log('PLAY_CONSOLE_RESULT: GUIDED');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline && !page.isClosed()) {
      await wait(15000);
      if (await isVisible(page, /in review|review in progress|changes? sent|published/i, 1000)) {
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
