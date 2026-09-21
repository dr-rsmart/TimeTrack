/**
 * rollout-production-vc18.mjs
 * ---------------------------
 * Final step of the vc18 production release: the draft already passed
 * "Prepare" -> "Preview and confirm" (URL .../releases/1/review). This
 * script opens that review page, DUMPS its buttons/text for diagnosis,
 * then clicks the rollout control and confirms.
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
const REVIEW_URL = `https://play.google.com/console/u/0/developers/${DEV}/app/${APP}/tracks/${TRACK}/releases/1/review`;

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

  await goto(REVIEW_URL);
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
    await goto(REVIEW_URL);
    await wait(7000);
  }

  // Dump the review page for diagnosis.
  const dump = await page
    .evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const items = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const visible =
          r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90);
        if (text && visible) items.push(`${el.tagName.toLowerCase()}|${text}`);
      }
      return {
        url: location.href,
        title: document.title,
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 3000),
        items,
      };
    })
    .catch(() => ({ url: '', title: '', text: '', items: [] }));
  console.log('REVIEW PAGE URL: ' + dump.url);
  console.log('BUTTONS: ' + JSON.stringify(dump.items.slice(0, 40)));
  console.log('TEXT SLICE: ' + dump.text.slice(0, 1500));
  await shot(page, 'review-page');

  // ── Click the rollout control (adaptive labels) ──
  const rolled = await clickVisible(
    page,
    'rollout control',
    [
      (p) => p.getByRole('button', { name: /start rollout/i }),
      (p) => p.getByText(/start rollout/i),
      (p) => p.getByRole('button', { name: /send (release )?(for|to) review/i }),
      (p) => p.getByText(/send (release )?(for|to) review/i),
      (p) => p.getByRole('button', { name: /review and send/i }),
      (p) => p.getByText(/review and send/i),
      (p) => p.getByRole('button', { name: /^rollout$/i }),
      (p) => p.getByRole('button', { name: /publish|go live/i }),
    ],
    30000,
  );
  if (rolled) {
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
    console.log('🟢 GUIDED MODE — finish in the open browser window (rollout button + confirm).');
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
