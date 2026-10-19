/**
 * Roll out vc29 (1.0.2) to Internal testing, Open testing, and Closed testing (Alpha),
 * then submit all changes on Publishing overview.
 */
import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.resolve(ROOT, '.playwright-google-profile');
const DEV_ID = '8121995548332442173';
const APP_ID = '4976072281005342488';
const ALPHA_TRACK = '4699609437092826823';
const RELEASE_NAME = '29 (1.0.2)';

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
    await page.screenshot({ path: path.resolve(ROOT, `play-testing-${name}.png`) });
  } catch {}
}

async function clickVisible(page, label, makers, timeout = 20000) {
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
    await wait(1200);
  }
  console.log(`⚠️  Could not click: ${label}`);
  return false;
}

async function isVisible(page, rx, timeout = 4000) {
  try {
    await page.getByText(rx).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}
async function promoteTrackToVc29(page, trackLabel, trackUrl, discardExistingDraft = false) {
  console.log(`\n=== Updating ${trackLabel} (${trackUrl}) ===`);
  await page.goto(trackUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(6000);
  if (await isVisible(page, /choose developer account/i, 3000)) {
    await clickVisible(
      page,
      'dr-rsmart',
      [(p) => p.getByText('dr-rsmart', { exact: true })],
      12000,
    );
    await wait(4000);
    await page.goto(trackUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(6000);
  }
  await shot(page, `${trackLabel}-1-landing`);

  if (await isVisible(page, /this track is paused|resume track/i, 2500)) {
    const resumed = await clickVisible(
      page,
      `Resume track (${trackLabel})`,
      [
        (p) => p.getByRole('button', { name: /resume track/i }),
        (p) => p.getByText('Resume track', { exact: true }),
      ],
      8000,
    );
    if (resumed) {
      await wait(2500);
      await clickVisible(
        page,
        'confirm resume dialog',
        [
          (p) =>
            p.locator('[role="dialog"]').getByRole('button', { name: /(resume|confirm|yes|ok)/i }),
        ],
        4000,
      );
      await wait(3000);
    }
  }

  if (discardExistingDraft && (await isVisible(page, /edit release/i, 3000))) {
    const openedDraft = await clickVisible(
      page,
      `Edit release (${trackLabel})`,
      [
        (p) => p.getByRole('button', { name: /edit release/i }),
        (p) => p.getByRole('link', { name: /edit release/i }),
        (p) => p.getByText('Edit release', { exact: true }),
      ],
      12000,
    );
    if (openedDraft) {
      await wait(5000);
      const clickedDiscard = await clickVisible(
        page,
        `Discard draft release (${trackLabel})`,
        [
          (p) => p.getByRole('button', { name: /discard draft release/i }),
          (p) => p.getByText('Discard draft release', { exact: true }),
        ],
        10000,
      );
      if (clickedDiscard) {
        await wait(2500);
        await clickVisible(
          page,
          'confirm Discard draft release modal',
          [
            (p) =>
              p
                .locator('[role="dialog"]')
                .getByRole('button', { name: /discard draft release|discard|delete|confirm/i }),
          ],
          10000,
        );
        await wait(5000);
      }
    }
  }

  const inEditor = await clickVisible(
    page,
    `Create/Edit release (${trackLabel})`,
    [
      (p) => p.getByRole('button', { name: /create new release/i }),
      (p) => p.getByText('Create new release', { exact: true }),
      (p) => p.getByRole('button', { name: /edit release/i }),
      (p) => p.getByRole('link', { name: /edit release/i }),
      (p) => p.getByText('Edit release', { exact: true }),
    ],
    20000,
  );
  if (!inEditor) return;
  await wait(5000);
  await shot(page, `${trackLabel}-2-editor`);

  for (let i = 0; i < 3; i++) {
    const exBtn = page.getByRole('button', { name: /^exclude$/i }).first();
    if (!(await exBtn.isVisible().catch(() => false))) break;
    await exBtn.click().catch(() => {});
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

  if (!(await isVisible(page, /29 \(1\.0\.2\)/, 3000))) {
    const fromLib = await clickVisible(
      page,
      `"Add from library" (${trackLabel})`,
      [
        (p) => p.getByText(/add from library/i),
        (p) => p.getByRole('button', { name: /add from library/i }),
      ],
      10000,
    );
    if (fromLib) {
      await wait(4000);
      await shot(page, `${trackLabel}-3-library`);
      const picked = await clickVisible(
        page,
        `vc29 checkbox in library (${trackLabel})`,
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
        await clickVisible(
          page,
          `"Add to release" (${trackLabel})`,
          [
            (p) => p.getByRole('button', { name: /add to release/i }),
            (p) => p.getByText('Add to release', { exact: true }),
          ],
          10000,
        );
        await wait(6000);
      } else {
        await page.keyboard.press('Escape').catch(() => {});
        await wait(1000);
      }
    }
  }

  const nameBox = page.getByLabel(/release name/i).first();
  if ((await nameBox.count()) > 0) await nameBox.fill(RELEASE_NAME).catch(() => {});
  const notesBox = page.locator('textarea').first();
  if ((await notesBox.count()) > 0 && (await notesBox.isVisible().catch(() => false))) {
    await notesBox.fill(RELEASE_NOTES).catch(() => {});
  }

  await shot(page, `${trackLabel}-4-before-next`);
  await clickVisible(
    page,
    `"Next" (${trackLabel})`,
    [(p) => p.getByRole('button', { name: /^next$/i })],
    25000,
  );
  await wait(5000);
  await shot(page, `${trackLabel}-5-preview`);

  await clickVisible(
    page,
    `"Save" / "Start rollout" (${trackLabel})`,
    [
      (p) => p.getByRole('button', { name: /^save$/i }),
      (p) => p.getByRole('button', { name: /start rollout/i }),
      (p) => p.getByText('Save', { exact: true }),
    ],
    20000,
  );
  await wait(4000);
  await shot(page, `${trackLabel}-6-after-save`);

  if (await isVisible(page, /go to publishing overview/i, 3000)) {
    await clickVisible(
      page,
      '"Not now" on Publishing overview modal',
      [
        (p) => p.getByRole('button', { name: /not now/i }),
        (p) => p.getByText('Not now', { exact: true }),
      ],
      6000,
    );
  } else {
    await clickVisible(
      page,
      'confirm rollout dialog',
      [
        (p) =>
          p
            .locator('[role="dialog"]')
            .getByRole('button', { name: /(rollout|start rollout|confirm|save)/i }),
      ],
      4000,
    );
  }
  await wait(4000);
  await shot(page, `${trackLabel}-7-done`);
}
async function run() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());
  const baseUrl = `https://play.google.com/console/u/0/developers/${DEV_ID}/app/${APP_ID}`;

  // 1. Internal testing (goes live immediately for internal testers!)
  await promoteTrackToVc29(page, 'internal', `${baseUrl}/tracks/internal-testing`, false);

  // 2. Open testing (resume track + promote to 29)
  await promoteTrackToVc29(page, 'open', `${baseUrl}/tracks/open-testing`, false);

  // 3. Closed testing - Alpha (discard broken draft + promote to 29)
  await promoteTrackToVc29(page, 'alpha', `${baseUrl}/tracks/${ALPHA_TRACK}`, true);

  // 4. Publishing overview — submit all pending changes for review
  const pubUrl = `${baseUrl}/publishing`;
  console.log(`\n=== Submitting all changes on Publishing overview (${pubUrl}) ===`);
  await page.goto(pubUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(6000);
  await shot(page, 'publishing-1-before');

  const clickedSubmit = await clickVisible(
    page,
    '"Send/Submit changes for review"',
    [
      (p) => p.getByRole('button', { name: /(send|submit) (\d+ )?changes? for review/i }),
      (p) => p.getByText(/(send|submit) (\d+ )?changes? for review/i),
    ],
    15000,
  );
  if (clickedSubmit) {
    await wait(3000);
    await shot(page, 'publishing-2-dialog');
    await clickVisible(
      page,
      'confirm dialog ("Restart review" / "Submit")',
      [
        (p) =>
          p
            .locator('[role="dialog"]')
            .getByRole('button', {
              name: /(restart review|(send|submit) (\d+ )?changes? for review|confirm)/i,
            }),
        (p) => p.getByRole('button', { name: /restart review/i }),
      ],
      12000,
    );
    await wait(6000);
  }
  await shot(page, 'publishing-3-final');
  console.log('ALL_TESTING_TRACKS_RESULT: DONE');
  await context.close().catch(() => {});
}

run().catch((e) => {
  console.error('ALL_TESTING_TRACKS_RESULT: ERROR —', e);
  process.exitCode = 1;
});
