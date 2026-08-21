import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_HEALTH_URL = process.env.API_URL || 'http://localhost:4000/api/health';

function checkEndpoint(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.get({ host: u.hostname, port: u.port, path: u.pathname, timeout: 2000 }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch {
      resolve(false);
    }
  });
}

async function startServersIfNeeded() {
  const apiOk = await checkEndpoint(API_HEALTH_URL);
  const webOk = await checkEndpoint(BASE_URL);

  const procs = [];

  if (!apiOk) {
    console.log('⚡ Starting API backend server on :4000...');
    const serverProc = spawn('npm', ['run', 'dev:server'], { stdio: 'ignore', shell: true });
    procs.push(serverProc);
  }

  if (!webOk) {
    console.log('⚡ Starting Vite frontend server on :5173...');
    const webProc = spawn('npm', ['run', 'dev:web'], { stdio: 'ignore', shell: true });
    procs.push(webProc);
  }

  console.log('⏳ Verifying servers are responsive...');
  for (let i = 0; i < 30; i++) {
    const isApiReady = await checkEndpoint(API_HEALTH_URL);
    const isWebReady = await checkEndpoint(BASE_URL);
    if (isApiReady && isWebReady) {
      console.log('✅ Both backend and frontend servers are healthy!');
      return procs;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error('Server health check timed out.');
}

const STORE_PROFILES = [
  // ── 1. iOS 6.7" Super Retina XDR (iPhone 16 Pro Max / 15 Pro Max / 14 Pro Max) ──
  // Resolution: 1290 x 2796 pixels
  {
    id: 'ios-iphone-6.7',
    label: 'iOS iPhone 6.7" Display (1290x2796)',
    folder: 'store-assets/ios/iphone-6.7',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },

  // ── 2. iOS 5.5" Retina Display (iPhone 8 Plus / 7 Plus / 6s Plus) ──
  // Resolution: 1242 x 2208 pixels
  {
    id: 'ios-iphone-5.5',
    label: 'iOS iPhone 5.5" Display (1242x2208)',
    folder: 'store-assets/ios/iphone-5.5',
    viewport: { width: 414, height: 736 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },

  // ── 3. iOS 12.9" iPad Pro (6th Gen) ──
  // Resolution: 2048 x 2732 pixels
  {
    id: 'ios-ipad-12.9',
    label: 'iOS iPad Pro 12.9" Display (2048x2732)',
    folder: 'store-assets/ios/ipad-12.9',
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
  },

  // ── 4. Android Phone (Modern 20:9 Aspect Ratio) ──
  // Resolution: 1080 x 2400 pixels
  {
    id: 'android-phone-1080x2400',
    label: 'Android Phone 20:9 (1080x2400)',
    folder: 'store-assets/android/phone-1080x2400',
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },

  // ── 5. Android 10" Tablet ──
  // Resolution: 1600 x 2560 pixels
  {
    id: 'android-tablet-10in',
    label: 'Android 10" Tablet (1600x2560)',
    folder: 'store-assets/android/tablet-10in',
    viewport: { width: 800, height: 1280 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
  },

  // ── 6. Android 7" Tablet ──
  // Resolution: 1200 x 1920 pixels
  {
    id: 'android-tablet-7in',
    label: 'Android 7" Tablet (1200x1920)',
    folder: 'store-assets/android/tablet-7in',
    viewport: { width: 600, height: 960 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
  },
];

async function generateGraphicsAssets(browser) {
  console.log('\n🎨 Exporting 512x512 App Icon & 1024x500 Feature Graphic...');
  const graphicsDir = path.resolve(process.cwd(), 'store-assets/graphics');
  fs.mkdirSync(graphicsDir, { recursive: true });

  const iconSrc = path.resolve(process.cwd(), 'public/TimeTrack Icon.png');
  const bannerSrc = path.resolve(process.cwd(), 'public/TimeTrack Banner.png');

  const iconBase64 = fs.readFileSync(iconSrc).toString('base64');

  // 1. App Icon 512x512
  const iconPage = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });

  await iconPage.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            width: 512px;
            height: 512px;
            background: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          img {
            width: 512px;
            height: 512px;
            object-fit: cover;
          }
        </style>
      </head>
      <body>
        <img src="data:image/png;base64,${iconBase64}" alt="TimeTrack App Icon" />
      </body>
    </html>
  `);

  await iconPage.screenshot({
    path: path.join(graphicsDir, 'app-icon-512x512.png'),
    type: 'png',
  });
  await iconPage.close();
  console.log('  ✅ Exported store-assets/graphics/app-icon-512x512.png (512x512)');

  // 2. Feature Graphic 1024x500
  const featurePage = await browser.newPage({
    viewport: { width: 1024, height: 500 },
    deviceScaleFactor: 1,
  });

  await featurePage.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          body {
            width: 1024px;
            height: 500px;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0284c7 100%);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 60px;
            color: #ffffff;
            overflow: hidden;
          }
          .left {
            max-width: 540px;
          }
          .badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(14, 165, 233, 0.2);
            border: 1px solid rgba(14, 165, 233, 0.4);
            color: #38bdf8;
            padding: 6px 14px;
            border-radius: 9999px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 20px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          h1 {
            font-size: 40px;
            font-weight: 800;
            line-height: 1.15;
            margin-bottom: 14px;
            letter-spacing: -0.02em;
          }
          h1 span {
            color: #38bdf8;
          }
          p {
            font-size: 17px;
            color: #94a3b8;
            line-height: 1.5;
          }
          .right {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .logo-box {
            width: 290px;
            height: 290px;
            background: #ffffff;
            border-radius: 32px;
            padding: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(56, 189, 248, 0.3);
          }
          .logo-box img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
        </style>
      </head>
      <body>
        <div class="left">
          <div class="badge">Enterprise Geofence & Time Tracking</div>
          <h1>Automated <span>Attendance</span> & Overtime Payroll</h1>
          <p>Real-time geofence auto clock-in/out, workforce roster scheduling, and verified compliance.</p>
        </div>
        <div class="right">
          <div class="logo-box">
            <img src="data:image/png;base64,${iconBase64}" alt="TimeTrack" />
          </div>
        </div>
      </body>
    </html>
  `);

  await featurePage.screenshot({
    path: path.join(graphicsDir, 'feature-graphic-1024x500.png'),
    type: 'png',
  });
  await featurePage.close();
  console.log('  ✅ Exported store-assets/graphics/feature-graphic-1024x500.png (1024x500)');
}

async function captureProfile(browser, dev) {
  console.log(`\n======================================================`);
  console.log(`📱 ${dev.label}`);
  console.log(`======================================================`);

  const targetDir = path.resolve(process.cwd(), dev.folder);
  fs.mkdirSync(targetDir, { recursive: true });

  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: dev.viewport,
    deviceScaleFactor: dev.deviceScaleFactor,
    isMobile: dev.isMobile,
    hasTouch: dev.hasTouch,
    permissions: ['geolocation', 'notifications'],
    geolocation: {
      latitude: -26.1076, // Sandton HQ
      longitude: 28.0567,
      accuracy: 10,
    },
  });

  const page = await context.newPage();

  // Inject GPS mock and storage keys
  await page.addInitScript(() => {
    const mockPosition = {
      coords: {
        latitude: -26.1076,
        longitude: 28.0567,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = (cb) => cb(mockPosition);
      navigator.geolocation.watchPosition = (cb) => {
        cb(mockPosition);
        return 1;
      };
    }

    localStorage.setItem('timetrack_auto_geofence_enabled', 'true');
    localStorage.setItem('timetrack_location_permission_asked', 'true');
  });

  try {
    // ── 01. Login Screen ──
    console.log(`  [1/7] Capturing 01_Login.png...`);
    await page.goto('/login');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(targetDir, '01_Login.png') });

    // Authenticate
    await page.fill('input[type="email"]', 'admin@timetrack.com');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button[type="submit"]');

    // Wait for SPA route change
    await page.waitForFunction(() => !window.location.pathname.includes('login'), null, { timeout: 10000 });
    await page.waitForTimeout(1000);

    // ── 02. Dashboard Attendance & KPIs ──
    console.log(`  [2/7] Capturing 02_Dashboard_Attendance.png...`);
    await page.screenshot({ path: path.join(targetDir, '02_Dashboard_Attendance.png') });

    // ── 03. Time Tracking & Live Geofence Clock ──
    console.log(`  [3/7] Capturing 03_TimeTracking_Live_Clock.png...`);
    await page.goto('/time');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(targetDir, '03_TimeTracking_Live_Clock.png') });

    // ── 04. Work Location & Geofences ──
    console.log(`  [4/7] Capturing 04_WorkLocation_Geofence_Management.png...`);
    await page.goto('/settings');
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'));
      const tab = tabs.find((t) => t.textContent && (t.textContent.includes('Geofence') || t.textContent.includes('Location')));
      if (tab) tab.click();
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(targetDir, '04_WorkLocation_Geofence_Management.png') });

    // ── 05. Timesheets & Payroll Reports ──
    console.log(`  [5/7] Capturing 05_Payroll_Timesheets_Reports.png...`);
    await page.goto('/reports');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(targetDir, '05_Payroll_Timesheets_Reports.png') });

    // ── 06. Workforce Directory ──
    console.log(`  [6/7] Capturing 06_Workforce_Employee_Directory.png...`);
    await page.goto('/employees');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(targetDir, '06_Workforce_Employee_Directory.png') });

    // ── 07. Shift Roster & Planner ──
    console.log(`  [7/7] Capturing 07_Shift_Roster_Schedule.png...`);
    await page.goto('/shifts');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(targetDir, '07_Shift_Roster_Schedule.png') });

    console.log(`  ✨ Successfully captured all 7 screens for ${dev.label}!`);
  } catch (err) {
    console.error(`  ❌ Error on ${dev.label}:`, err);
  } finally {
    await context.close();
  }
}

async function main() {
  const procs = await startServersIfNeeded();
  const browser = await chromium.launch({ headless: true });

  await generateGraphicsAssets(browser);

  for (const dev of STORE_PROFILES) {
    await captureProfile(browser, dev);
  }

  await browser.close();

  for (const proc of procs) {
    try { proc.kill(); } catch {}
  }

  console.log('\n======================================================');
  console.log('🎉 ALL STORE ASSETS GENERATED COMPLIANTLY (NO MOCKUPS)!');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
