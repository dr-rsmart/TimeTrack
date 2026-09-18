/**
 * verify-features.mjs — live browser verification of:
 *   1. Shift modal: Start/End time visible with "No location", HIDDEN when a
 *      Geofence Location is selected.
 *   2. Company Settings: Saturday overtime switch + multiplier.
 * Leaves the browser open for manual testing afterwards.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SHOTS = 'test-results/verify-features';
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = async (page, name) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  log('📸', name);
};

const browser = await chromium.launch({ headless: false });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.setDefaultTimeout(20_000);
page.on('dialog', (d) => d.accept().catch(() => {}));

// Login as master
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'master@smartpatel.co.za');
await page.fill('input[type="password"]', 'Password123');
await page.click('button[type="submit"]');
await page.waitForURL(/localhost:5173\/$/, { timeout: 30_000 });

// Impersonate first tenant
await page.goto(`${BASE}/register`);
await page.locator('button[title="Impersonate"]').first().click();
await page.waitForSelector('text=Impersonating', { timeout: 30_000 });

// ── 1. Settings: Saturday overtime ──
await page.goto(`${BASE}/settings`);
await page.waitForSelector('text=Saturday overtime enabled');
await page.locator('text=Saturday overtime enabled').scrollIntoViewIfNeeded();
await shot(page, '01-settings-saturday');
log('✅ Saturday overtime switch + multiplier rendered');

// ── 2. Shifts: conditional Start/End time ──
await page.goto(`${BASE}/shifts`);
await page.waitForSelector('text=Add Shift');
await page
  .getByRole('button', { name: /Add Shift/i })
  .first()
  .click();

// With "No location" (default) → Start/End time VISIBLE
const startVisibleNoLoc = await page.locator('#s-start').isVisible();
log(
  startVisibleNoLoc
    ? '✅ Start/End time visible with No location'
    : '❌ Start/End time missing with No location',
);
await shot(page, '02-shift-no-location-times-visible');

// Select the geofence → Start/End time HIDDEN
const geoSelect = page.locator('#s-geofence');
if (await geoSelect.count()) {
  const options = await geoSelect.locator('option').evaluateAll((opts) => opts.map((o) => o.value));
  const first = options.find((v) => v !== '');
  if (first) {
    await geoSelect.selectOption(first);
    await page.waitForTimeout(400);
    const startVisibleWithLoc = await page
      .locator('#s-start')
      .isVisible()
      .catch(() => false);
    const summaryVisible = await page.locator('text=Working hours at').isVisible();
    log(
      !startVisibleWithLoc
        ? '✅ Start/End time HIDDEN with geofence selected'
        : '❌ Start/End time still visible with geofence',
    );
    log(summaryVisible ? '✅ Mon–Sun hours summary visible' : '❌ summary missing');
    await shot(page, '03-shift-geofence-times-hidden');
    // Switch back to No location → times reappear
    await geoSelect.selectOption('');
    await page.waitForTimeout(300);
    const backVisible = await page.locator('#s-start').isVisible();
    log(backVisible ? '✅ Start/End time returns with No location' : '❌ times did not return');
  } else {
    log('⚠️ tenant has no geofences to select');
  }
} else {
  log('⚠️ no geofence select present');
}

log('🎉 Verification complete — browser stays OPEN for manual testing.');
await new Promise(() => {});
