/**
 * Google Play Console — Closed testing ("alpha") rollout updater for VC29
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AAB_PATH = path.resolve(ROOT, process.env.TT_AAB || 'timetrack-vc29.aab');
const RELEASE_NAME = process.env.TT_RELEASE || '29 (1.0.2)';
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const DEV_ID = '8121995548332442173';
const APP_ID = '4976072281005342488';
const ALPHA_TRACK = '4699609437092826823';

const RELEASE_NOTES = [
  '<en-ZA>',
  'TimeTrack 1.0.2',
  '- Reliable push notifications for shift reminders and attendance alerts',
  '- Auto clock-in/out with offline punch capture and automatic sync',
  '- Daily breakdown per employee and cost-of-late insights',
  '- Stability improvements and polish',
  '</en-ZA>',
].join('\n');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  console.log(`🔎 [${name}] url=${page.url()}`);
  try {
    await page.screenshot({ path: path.resolve(ROOT, `play-console-closealpha-${name}.png`) });
  } catch {}
}

async function clickVisible(page, label, makers, timeout = 25000) {
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
            await el.click({ timeout: 5000 }).catch(() => el.click({ force: true, timeout: 5000 }));
            console.log(`✅ Clicked: ${label}`);
            return true;
          }
        }
      } catch {}
    }
    await wait(1500);
  }
  console.log(`⚠️  Could not click: ${label}`);
  return false;
}

async function isVisible(page, rx, timeout = 5000) {
  try {
    await page.getByText(rx).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function submitAndPublish(page) {
  await clickVisible(page, '"Next"', [(p) => p.getByRole('button', { name: /^next$/i })], 45000);
  await wait(5000);
  await shot(page, 'preview-and-confirm');

  await clickVisible(page, '"Save"', [(p) => p.getByRole('button', { name: /^save$/i })], 25000);
  await wait(4000);
  await shot(page, 'after-save-modal');

  const wentToOverview = await clickVisible(
    page,
    '"Go to overview"',
    [
      (p) => p.getByRole('button', { name: /go to overview/i }),
      (p) => p.getByText(/go to overview/i),
    ],
    12000,
  );
  if (!wentToOverview) {
    await page
      .goto(`https://play.google.com/console/u/0/developers/${DEV_ID}/app/${APP_ID}/publishing`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      .catch(() => {});
  }
  await wait(6000);
  await shot(page, 'publishing-overview');

  const clickedSubmit = await clickVisible(
    page,
    '"Send/Submit changes for review"',
    [
      (p) => p.getByRole('button', { name: /(send|submit) (\d+ )?changes? for review/i }),
      (p) => p.getByText(/(send|submit) (\d+ )?changes? for review/i),
    ],
    20000,
  );
  if (clickedSubmit) {
    await wait(3000);
    await shot(page, 'publishing-confirm-dialog');
    await clickVisible(
      page,
      'confirm dialog',
      [
        (p) =>
          p
            .locator('[role="dialog"]')
            .getByRole('button', {
              name: /(restart review|(send|submit) (\d+ )?changes? for review)/i,
            }),
        (p) =>
          p
            .locator('[role="dialog"]')
            .getByRole('button', { name: /^(restart|send|submit|confirm|yes)/i }),
        (p) => p.getByRole('button', { name: /restart review/i }),
        (p) => p.getByRole('button', { name: /(send|submit) (\d+ )?changes? for review/i }),
      ],
      15000,
    );
    await wait(5000);
  }
}
async function run() {
  if (!fs.existsSync(AAB_PATH)) {
    console.log(`PLAY_CONSOLE_RESULT: ERROR — missing ${AAB_PATH}`);
    process.exitCode = 1;
    return;
  }
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());

  const pubUrl = `https://play.google.com/console/u/0/developers/${DEV_ID}/app/${APP_ID}/publishing`;
  await page.goto(pubUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(7000);

  if (await isVisible(page, /choose developer account/i, 4000)) {
    await clickVisible(
      page,
      'dr-rsmart',
      [(p) => p.getByText('dr-rsmart', { exact: true })],
      15000,
    );
    await wait(5000);
    await page.goto(pubUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(7000);
  }

  // If 28 (1.0.2) is currently in review on Publishing overview, remove it so 29 (1.0.2) replaces it
  if (
    (await isVisible(page, /28 \(1\.0\.2\)/, 4000)) &&
    !(await isVisible(page, /29 \(1\.0\.2\)/, 2000))
  ) {
    console.log('🗑️ Removing 28 (1.0.2) from Changes in review...');
    const removed = await clickVisible(
      page,
      '"Remove changes"',
      [
        (p) => p.getByRole('button', { name: /remove changes/i }),
        (p) => p.getByText('Remove changes', { exact: true }),
      ],
      10000,
    );
    if (removed) {
      await wait(2500);
      await clickVisible(
        page,
        'confirm remove changes',
        [
          (p) => p.locator('[role="dialog"]').getByRole('button', { name: /remove|confirm|yes/i }),
          (p) => p.getByRole('button', { name: /^remove$/i }),
        ],
        10000,
      );
      await wait(5000);
    }
  }

  const alphaUrl = `https://play.google.com/console/u/0/developers/${DEV_ID}/app/${APP_ID}/tracks/${ALPHA_TRACK}`;
  await page.goto(alphaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(7000);
  await shot(page, 'alpha-track-page');

  const inEditor = await clickVisible(
    page,
    'Edit or Create release',
    [
      (p) => p.getByRole('button', { name: /edit release/i }),
      (p) => p.getByRole('link', { name: /edit release/i }),
      (p) => p.getByText('Edit release', { exact: true }),
      (p) => p.getByRole('button', { name: /create new release/i }),
      (p) => p.getByText('Create new release', { exact: true }),
    ],
    20000,
  );

  if (inEditor) {
    await wait(6000);
    await shot(page, 'release-editor');

    const excludeBtns = page.getByRole('button', { name: /^exclude$/i });
    const exCount = await excludeBtns.count();
    for (let i = 0; i < exCount; i++) {
      const btn = excludeBtns.first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await wait(2500);
        await clickVisible(
          page,
          'exclude confirm',
          [
            (p) =>
              p
                .locator('[role="dialog"]')
                .getByRole('button', { name: /(remove|exclude|confirm|yes|ok)/i }),
          ],
          3000,
        );
        await wait(2000);
      }
    }

    if (!(await isVisible(page, /29 \(1\.0\.2\)/, 3000))) {
      const fromLibrary = await clickVisible(
        page,
        '"Add from library"',
        [
          (p) => p.getByText(/add from library/i),
          (p) => p.getByRole('button', { name: /add from library/i }),
        ],
        10000,
      );
      let attachedFromLib = false;
      if (fromLibrary) {
        await wait(4000);
        const picked = await clickVisible(
          page,
          'vc29 checkbox in library',
          [
            (p) =>
              p
                .locator('tr')
                .filter({ hasText: /29\s+1\.0\.2/ })
                .getByRole('checkbox'),
            (p) =>
              p.locator(
                'xpath=(//*[normalize-space(text())="29"]/preceding::*[self::input[@type="checkbox"] or @role="checkbox"])[last()]',
              ),
          ],
          12000,
        );
        if (picked) {
          await wait(1500);
          attachedFromLib = await clickVisible(
            page,
            '"Add to release"',
            [
              (p) => p.getByRole('button', { name: /add to release/i }),
              (p) => p.getByText('Add to release', { exact: true }),
            ],
            10000,
          );
          if (attachedFromLib) await wait(8000);
        } else {
          await page.keyboard.press('Escape').catch(() => {});
          await wait(1000);
        }
      }
      if (!attachedFromLib) {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached', timeout: 10000 });
        await fileInput.setInputFiles(AAB_PATH);
        console.log(`✅ Uploading ${path.basename(AAB_PATH)}...`);
        const dl = Date.now() + 90000;
        while (Date.now() < dl) {
          if (await isVisible(page, /29 \(1\.0\.2\)/, 3000)) break;
          await wait(3000);
        }
        await wait(3000);
      }
    }

    const nameBox = page.getByLabel(/release name/i).first();
    if ((await nameBox.count()) > 0) await nameBox.fill(RELEASE_NAME).catch(() => {});
    const notesBox = page.locator('textarea').first();
    if ((await notesBox.count()) > 0 && (await notesBox.isVisible().catch(() => false))) {
      await notesBox.fill(RELEASE_NOTES).catch(() => {});
    }

    await shot(page, 'before-review');
    await submitAndPublish(page);
  }

  await shot(page, 'final');
  console.log('PLAY_CONSOLE_RESULT: DONE');
  await context.close().catch(() => {});
}

run().catch((e) => {
  console.error('PLAY_CONSOLE_RESULT: ERROR —', e);
  process.exitCode = 1;
});
