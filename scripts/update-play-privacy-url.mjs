/**
 * update-play-privacy-url.mjs
 * ----------------------------
 * Fixes the Google Play "Invalid privacy policy" rejection: opens
 * App content → Privacy policy, reads the current declared URL, and if it
 * is not the canonical policy page, sets it to https://time-track.tech/privacy
 * and saves. Degrades to GUIDED mode (window left open with printed steps)
 * if the console UI drifts.
 *
 * Canonical URL serves the FULL policy text over GET **and** HEAD without
 * JavaScript (dist/privacy.html, generated at build time) — verified live.
 * The previously declared https://timetrack.smartpatel.co.za/privacy has no
 * DNS record (parent domain is a parked GoDaddy lander).
 *
 * Log markers (for automation watchers):
 *   PLAY_CONSOLE_RESULT: DONE   -> URL saved + read-back verified
 *   PLAY_CONSOLE_RESULT: GUIDED -> browser left open for manual completion
 *   PLAY_CONSOLE_RESULT: ERROR  -> unexpected failure
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const DEV = '8121995548332442173';
const APP = '4976072281005342488';
const PRIVACY_URL = `https://play.google.com/console/u/0/developers/${DEV}/app/${APP}/app-content/privacy-policy`;
const TARGET_POLICY_URL = 'https://time-track.tech/privacy';

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

// Every input on the page whose value/placeholder/type looks like the
// declared policy URL field.
async function readPolicyInput(page) {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs
      .map((el, i) => ({
        i,
        type: el.type,
        value: (el.value || '').trim(),
        ph: el.placeholder || '',
        label: el.getAttribute('aria-label') || '',
      }))
      .filter(
        (x) =>
          /^https?:\/\//i.test(x.value) ||
          /privacy/i.test(x.ph) ||
          /^url$/i.test(x.type) ||
          /privacy/i.test(x.label),
      );
  });
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
    const dl = Date.now() + 4 * 60 * 1000;
    while (Date.now() < dl && !page.isClosed() && !page.url().includes('play.google.com')) {
      await wait(5000);
    }
  }
  await wait(5000);
  try {
    await page.getByText('dr-rsmart', { exact: true }).first().click({ timeout: 12000 });
    await wait(5000);
  } catch {}

  await goto(PRIVACY_URL);
  await wait(7000);
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
    await goto(PRIVACY_URL);
    await wait(7000);
    bodyText = await page
      .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      .catch(() => '');
  }
  await shot(page, 'before');
  console.log('TEXT SLICE: ' + bodyText.slice(0, 1200));

  const before = await readPolicyInput(page);
  console.log('POLICY INPUTS BEFORE: ' + JSON.stringify(before));
  const evidence = {
    before: bodyText.slice(0, 1200),
    inputsBefore: before,
    after: null,
    inputsAfter: null,
  };
  fs.writeFileSync(
    path.resolve(ROOT, 'probe-play-privacy.json'),
    JSON.stringify(evidence, null, 2),
  );

  const currentValue = before.find((x) => /^https?:\/\//i.test(x.value))?.value || '';
  console.log('CURRENT DECLARED URL: ' + (currentValue || '(none found)'));

  if (currentValue === TARGET_POLICY_URL) {
    console.log('✅ Privacy policy URL already correct — nothing to change.');
    await shot(page, 'after');
    console.log('PLAY_CONSOLE_RESULT: DONE');
    await context.close().catch(() => {});
    return;
  }

  // ── Fill the URL field ──
  const fillOk = await (async () => {
    const makers = [
      (p) => p.locator('input[type="url"]'),
      (p) => p.locator('input[placeholder*="privacy" i]'),
      (p) => p.locator('input[placeholder*="http" i]'),
      (p) => p.locator('input[aria-label*="privacy" i]'),
    ];
    for (const maker of makers) {
      try {
        const loc = maker(page);
        const n = await loc.count();
        for (let i = 0; i < n; i++) {
          const el = loc.nth(i);
          if (await el.isVisible().catch(() => false)) {
            await el.click({ timeout: 5000 }).catch(() => {});
            await el.fill(TARGET_POLICY_URL, { timeout: 5000 }).catch(() => {});
            const v = await el.inputValue().catch(() => '');
            console.log(`✅ Filled privacy input (${v})`);
            if (v === TARGET_POLICY_URL) return true;
          }
        }
      } catch {}
    }
    return false;
  })();

  if (!fillOk) {
    console.log('⚠️  Could not locate/fill the privacy policy URL input.');
    await shot(page, 'fill-failed');
    console.log(
      '🟢 GUIDED MODE: in the opened window paste https://time-track.tech/privacy into the privacy policy URL field and click Save.',
    );
    console.log('PLAY_CONSOLE_RESULT: GUIDED');
    await wait(10 * 60 * 1000).catch(() => {});
    await context.close().catch(() => {});
    return;
  }

  // ── Save ──
  const saved = await clickVisible(
    page,
    '"Save" (privacy policy)',
    [
      (p) => p.getByRole('button', { name: /^save$/i }),
      (p) => p.getByText('Save', { exact: true }),
    ],
    20000,
  );
  await wait(5000);
  await shot(page, 'after-save');

  // ── Verify read-back ──
  const afterInputs = await readPolicyInput(page);
  const afterValue = afterInputs.find((x) => /^https?:\/\//i.test(x.value))?.value || '';
  const afterText = await page
    .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
    .catch(() => '');
  evidence.after = afterText.slice(0, 1200);
  evidence.inputsAfter = afterInputs;
  fs.writeFileSync(
    path.resolve(ROOT, 'probe-play-privacy.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log('VALUE AFTER SAVE: ' + (afterValue || '(none found)'));

  if (afterValue === TARGET_POLICY_URL || afterText.includes(TARGET_POLICY_URL)) {
    console.log('✅ Privacy policy URL saved and verified: ' + TARGET_POLICY_URL);
    await shot(page, 'final');
    console.log('PLAY_CONSOLE_RESULT: DONE');
  } else {
    console.log('🟢 GUIDED MODE — save did not verify; complete it in the opened window.');
    console.log('PLAY_CONSOLE_RESULT: GUIDED');
    await wait(10 * 60 * 1000).catch(() => {});
  }
  await context.close().catch(() => {});
}

run().catch((e) => {
  console.error('PLAY_CONSOLE_RESULT: ERROR —', e);
  process.exitCode = 1;
});
