/**
 * watch-play-review.mjs — single-shot status watcher for the Play publishing
 * overview. Confirms whether the in-review changes (production "Start full
 * rollout" of 18 (1.0.0), South Africa, privacy policy URL) have been
 * approved and published by Google yet.
 *
 * Read-only. Uses the same persistent Google profile as the other Play
 * automation scripts. Prints a machine-readable marker:
 *   PLAY_WATCH: IN_REVIEW | LIVE | READY_TO_SEND | REJECTED | UNKNOWN | ERROR
 *
 * Optional polling loop:
 *   node scripts/watch-play-review.mjs --loop --interval 15
 * (re-probes every N minutes until the state leaves IN_REVIEW, then exits 0.)
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
const PUBLISHING_URL = `https://play.google.com/console/u/0/developers/${DEV}/app/${APP}/publishing`;

const args = process.argv.slice(2);
const LOOP = args.includes('--loop');
const intervalIdx = args.indexOf('--interval');
const INTERVAL_MIN = intervalIdx >= 0 ? Math.max(1, Number(args[intervalIdx + 1]) || 15) : 15;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function classify() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    try {
      await page.goto(PUBLISHING_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch {}
    if (page.url().includes('accounts.google.com')) {
      console.log('🔐 Play Console sign-in required in the opened window.');
      const dl = Date.now() + 5 * 60 * 1000;
      while (Date.now() < dl && !page.isClosed() && page.url().includes('accounts.google.com')) {
        await wait(5000);
      }
    }
    // Wait for the SPA to render.
    const READY =
      /Test and release|Publishing overview|In review|Submit .* for review|Sign in|Choose an account|dr-rsmart|rejected|Production/i;
    let text = '';
    for (let i = 0; i < 20; i++) {
      text = await page
        .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
        .catch(() => '');
      if (READY.test(text)) break;
      await wait(3000);
    }
    const t = text.slice(0, 6000);
    let state = 'UNKNOWN';
    if (/changes? in review|in review|review in progress|being reviewed/i.test(t))
      state = 'IN_REVIEW';
    else if (
      /published to production|production.*published|fully live|available on google play/i.test(t)
    )
      state = 'LIVE';
    else if (/submit \d+ changes? for review|ready to send|changes? ready/i.test(t))
      state = 'READY_TO_SEND';
    else if (/rejected|policy status/i.test(t) && !/in review/i.test(t)) state = 'REJECTED';
    console.log('PLAY_WATCH: ' + state);
    console.log('TEXT SLICE: ' + t.slice(0, 1500));
    return state;
  } finally {
    await context.close().catch(() => {});
  }
}

async function run() {
  let state = await classify();
  if (!LOOP) return 0;
  while (state === 'IN_REVIEW') {
    console.log(`⏳ still in review — re-checking in ${INTERVAL_MIN} min…`);
    await wait(INTERVAL_MIN * 60 * 1000);
    state = await classify();
  }
  return 0;
}

run()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('PLAY_WATCH: ERROR —', e && e.message ? e.message.split('\n')[0] : String(e));
    process.exit(1);
  });
