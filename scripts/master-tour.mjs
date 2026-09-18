/**
 * master-tour.mjs — local smoke tour of the 2026-09-18 release changes.
 *
 * Opens a VISIBLE browser, logs in as the platform master, impersonates the
 * first tenant and exercises:
 *   - Login page inputs (light-pinned for dark theme fix)
 *   - Company Settings → Default working hours (multi-slot + Add hours)
 *   - Geofences / Locations → Add Location → Global working hours slots
 *   - Shifts → Add Shift → Geofence Location selector + Mon–Sun summary
 *   - Dark theme + narrow header (menu must never cover the logo)
 * Screenshots land in test-results/master-tour/. The browser is LEFT OPEN so
 * the system can be viewed and tested manually afterwards.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SHOTS = 'test-results/master-tour';
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = async (page, name) => {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    log('📸', name);
  } catch (e) {
    log('⚠️ screenshot failed:', name, e.message);
  }
};
const step = async (label, fn) => {
  try {
    await fn();
    log('✅', label);
    return true;
  } catch (e) {
    log('❌', label, '—', e.message.split('\n')[0]);
    return false;
  }
};

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
page.on('dialog', (d) => d.accept().catch(() => {}));

// ── 1. Login ──
await page.goto(`${BASE}/login`);
await page.waitForSelector('input[type="email"]');
await shot(page, '01-login');

await page.fill('input[type="email"]', 'master@smartpatel.co.za');
await page.fill('input[type="password"]', 'Password123');
await shot(page, '02-login-filled');
await page.click('button[type="submit"]');
await page.waitForURL(/localhost:5173\/$/, { timeout: 30_000 });
await page.waitForLoadState('networkidle').catch(() => {});
await shot(page, '03-master-dashboard');

// ── 2. Tenant register → impersonate first tenant ──
await step('impersonate first tenant', async () => {
  await page.goto(`${BASE}/register`);
  const btn = page.locator('button[title="Impersonate"]').first();
  await btn.waitFor({ state: 'visible' });
  await btn.click();
  await page.waitForSelector('text=Impersonating', { timeout: 30_000 });

  // ── 3. Company Settings → Default working hours (multi-slot) ──
  await step('default working hours slots', async () => {
    await page.goto(`${BASE}/settings`);
    await page.waitForSelector('text=Default working hours');
    await page.locator('text=Default working hours').first().scrollIntoViewIfNeeded();
    await shot(page, '05-default-hours');
    const addBtn = page.getByRole('button', { name: /Add hours/i }).first();
    await addBtn.click();
    // The tenant's default list may start empty → first Add creates slot 1.
    await page.waitForSelector('text=/Hours slot \\d/');
    await shot(page, '06-default-hours-slot-added');
  });

  // ── 4. Geofences tab → Add Location → Global working hours ──
  await step('geofence global working hours', async () => {
    await page.getByRole('button', { name: /Geofences \/ Locations/i }).click();
    await page.waitForSelector('text=Work Locations (Geofences)');
    await shot(page, '07-geofences-tab');
    await page.getByRole('button', { name: /\+ Add Location/i }).click();
    await page.waitForSelector('text=Global working hours');
    await page.locator('text=Global working hours').scrollIntoViewIfNeeded();
    await shot(page, '08-location-form-hours');
    const addHours = page.getByRole('button', { name: /\+ Add hours/i }).first();
    await addHours.click();
    await page.waitForSelector('text=Hours slot 2');
    await shot(page, '09-location-two-slots');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  // ── 5. Shifts → Add Shift → Geofence Location + Mon–Sun summary ──
  await step('shift geofence selector + summary', async () => {
    await page.goto(`${BASE}/shifts`);
    await page.waitForSelector('text=Add Shift');
    await page
      .getByRole('button', { name: /Add Shift/i })
      .first()
      .click();
    const geoSelect = page.locator('#s-geofence');
    await geoSelect.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    if (await geoSelect.count()) {
      await shot(page, '10-shift-modal');
      const options = await geoSelect
        .locator('option')
        .evaluateAll((opts) => opts.map((o) => ({ value: o.value, text: o.textContent })));
      log('   geofence options:', JSON.stringify(options));
      const first = options.find((o) => o.value !== '');
      if (first) {
        await geoSelect.selectOption(first.value);
        await page.waitForSelector('text=Working hours at');
        await shot(page, '11-shift-geofence-summary');
      }
    } else {
      log('   ⚠️ no #s-geofence select rendered (tenant may have no active geofences)');
      await shot(page, '10-shift-modal-no-geofences');
    }
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  // ── 6. Dark theme + narrow header (logo never covered by the menu) ──
  await step('dark theme + narrow header', async () => {
    await page.goto(`${BASE}/`);
    const toggle = page.locator('button[aria-label="Toggle theme"]').first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(600);
      await shot(page, '12-dark-dashboard');
    }
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(400);
    await shot(page, '13-header-narrow-900');
    await page.setViewportSize({ width: 1440, height: 900 });
    if (await toggle.count()) {
      await toggle.click(); // back to light
      await page.waitForTimeout(400);
    }
  });

  log('🎉 Tour complete — the browser stays OPEN for manual viewing/testing.');
  log('   Master login: master@smartpatel.co.za / Password123');
  // Keep the browser open until the process is killed.
  await new Promise(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await shot(page, '04-impersonating');
});
