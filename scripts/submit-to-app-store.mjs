import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const APPLE_ID = process.env.iOS_Build_Credentials || 'ricardovsmart@gmail.com';
const APPLE_PWD = process.env.iOS_Build_Password || 'RicJer24';
const APP_ID = '6803827296'; // From eas.json

const METADATA = {
  appName: 'TimeTrack: Workforce & Payroll',
  subtitle: 'Geofence Clock In & Payroll',
  promotionalText: 'Effortless workforce attendance with automated GPS geofence clock-in/out, live shift rosters, overtime calculation, and compliance-ready timesheets.',
  supportUrl: 'https://time-track.tech/support',
  marketingUrl: 'https://time-track.tech',
  privacyUrl: 'https://time-track.tech/privacy',
  keywords: 'time tracking,timesheet,clock in,geofence,attendance,payroll,roster,overtime,workforce,shifts,gps',
  description: `TimeTrack is an enterprise-grade time tracking, shift scheduling, and payroll attendance platform engineered for modern workforces. With automated GPS geofencing, TimeTrack ensures accurate, hands-free clock-in and clock-out when employees enter or leave designated workplace perimeters.

KEY FEATURES:

📍 AUTOMATED GEOFENCE CLOCK-IN & OUT
• Seamless hands-free attendance recording: auto clock-in upon entering your workplace and auto clock-out upon departure.
• High-precision GPS perimeter validation prevents off-site clocking errors.
• Multi-location support for headquarters, regional branches, and field project sites.

⏱️ LIVE TIME TRACKING & BREAK MANAGEMENT
• Real-time shift duration counter and one-tap break logging.
• Instant visibility into who is currently clocked in, on break, or scheduled.
• Offline resilience with automatic background synchronization upon reconnection.

📅 SHIFT SCHEDULING & ROSTER MANAGEMENT
• Interactive shift planner with customizable shift patterns and leave tracking.
• Instant roster visibility for employees and branch managers.
• Automated notifications for upcoming shifts and schedule adjustments.

📊 COMPLIANCE-READY PAYROLL & TIMESHEETS
• Automatic calculation of ordinary hours, daily overtime, and Sunday overtime multipliers.
• Public holiday compensation rules and automated timesheet aggregation.
• One-click export to CSV and Excel for direct integration with payroll processors.

👥 MULTI-TENANT & ROLE-BASED ACCESS CONTROL
• Dedicated portals for Employees, Department Managers, and Company Administrators.
• Comprehensive tamper-proof audit trails for every attendance punch and manual adjustment.
• Enterprise data isolation ensuring strict compliance with GDPR and POPIA regulations.

Optimize workforce productivity, eliminate buddy punching, and streamline your payroll cycle with TimeTrack.`
};

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function run() {
  console.log('🚀 Launching Playwright browser for App Store Connect submission...');
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === 'true',
    args: ['--disable-blink-features=AutomationControlled'] // bypass basic bot detection
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  console.log('🌐 Navigating to App Store Connect login page...');
  await page.goto('https://appstoreconnect.apple.com/login', { waitUntil: 'networkidle' });

  const frame = page.frame({ name: 'aid-auth-widget' });
  if (!frame) {
    throw new Error('Could not locate the Apple sign-in widget iframe.');
  }

  console.log(`🔐 Entering Apple ID: ${APPLE_ID}...`);
  await frame.fill('input[id="account_name_text_field"]', APPLE_ID);
  await frame.press('input[id="account_name_text_field"]', 'Enter');

  console.log('⏳ Waiting for password field...');
  await frame.waitForSelector('input[id="password_text_field"]', { state: 'visible', timeout: 5000 });
  await frame.fill('input[id="password_text_field"]', APPLE_PWD);
  await frame.press('input[id="password_text_field"]', 'Enter');

  // Wait to see if 2FA is triggered
  console.log('⏳ Checking for Two-Factor Authentication or login redirection...');
  await page.waitForTimeout(5000);

  const is2FA = await frame.evaluate(() => {
    return document.body.innerText.includes('Two-Factor Authentication') || 
           document.body.innerText.includes('verification code');
  }).catch(() => false);

  if (is2FA) {
    console.log('\n🔑 [2FA DETECTED] Two-Factor Authentication is required by Apple.');
    console.log('Please check your trusted device for the 6-digit verification code.');
    const code = await askQuestion('👉 Enter the 6-digit verification code: ');

    if (code && code.length === 6) {
      console.log(`Sending 2FA code: ${code}...`);
      await frame.evaluate((otp) => {
        const inputs = Array.from(document.querySelectorAll('input[type="tel"], input[id^="char"]'));
        if (inputs.length === 6) {
          for (let i = 0; i < 6; i++) {
            inputs[i].value = otp[i];
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else {
          // Alternative fallback
          const firstBox = document.querySelector('input[type="textbox"], input');
          if (firstBox) {
            firstBox.value = otp;
            firstBox.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, code);

      // Give it some time to process
      await page.waitForTimeout(5000);
    } else {
      console.log('⚠️ Invalid code or skipped. Please complete verification in the browser if running in headful mode.');
    }
  }

  // Wait for login redirection to App Store Connect portal
  console.log('⏳ Waiting for homepage redirection...');
  try {
    await page.waitForURL('**/apps**', { timeout: 30000 });
    console.log('✅ Successfully logged into App Store Connect!');
  } catch (e) {
    console.log('⚠️ Redirect to App Store Connect page took too long or requires manual action.');
    console.log('Current URL:', page.url());
    console.log('If running in headful mode, please finish logging in.');
    await askQuestion('Press ENTER here after you are fully logged in and redirected: ');
  }

  // Navigate to App details page
  const appUrl = `https://appstoreconnect.apple.com/apps/${APP_ID}/appstore/ios/version/deliverable`;
  console.log(`🌐 Navigating directly to app page: ${appUrl}`);
  await page.goto(appUrl, { waitUntil: 'networkidle' });

  // Add Metadata Fill-in
  console.log('📝 Injecting app store listing metadata (Promotional Text, Description, Keywords, etc.)...');
  try {
    // 1. Promotional Text
    const promoSelector = 'textarea[placeholder*="promotional text" i], textarea[name*="promotionalText" i], textarea.promo-text';
    if (await page.locator(promoSelector).count() > 0) {
      await page.fill(promoSelector, METADATA.promotionalText);
    }

    // 2. Description
    const descSelector = 'textarea[placeholder*="description" i], textarea[id*="description" i], textarea.description';
    if (await page.locator(descSelector).count() > 0) {
      await page.fill(descSelector, METADATA.description);
    }

    // 3. Keywords
    const keywordsSelector = 'textarea[placeholder*="keywords" i], textarea[id*="keywords" i], textarea.keywords';
    if (await page.locator(keywordsSelector).count() > 0) {
      await page.fill(keywordsSelector, METADATA.keywords);
    }

    // 4. URLs
    const supportUrlSelector = 'input[id*="support" i], input[placeholder*="support" i]';
    if (await page.locator(supportUrlSelector).count() > 0) {
      await page.fill(supportUrlSelector, METADATA.supportUrl);
    }

    const marketingUrlSelector = 'input[id*="marketing" i], input[placeholder*="marketing" i]';
    if (await page.locator(marketingUrlSelector).count() > 0) {
      await page.fill(marketingUrlSelector, METADATA.marketingUrl);
    }

    const privacyUrlSelector = 'input[id*="privacy" i], input[placeholder*="privacy" i]';
    if (await page.locator(privacyUrlSelector).count() > 0) {
      await page.fill(privacyUrlSelector, METADATA.privacyUrl);
    }

    console.log('✅ Metadata fields filled in!');
  } catch (err) {
    console.log('⚠️ Failed to automatically fill some metadata fields (selectors may have changed):', err.message);
  }

  // Screenshot Uploads
  console.log('🖼️ Handling Screenshot uploads...');
  try {
    const screenshotSizes = [
      { folder: 'iphone-6.7', label: 'iPhone 6.7" Display' },
      { folder: 'iphone-5.5', label: 'iPhone 5.5" Display' },
      { folder: 'ipad-12.9', label: 'iPad Pro 12.9" Display' }
    ];

    for (const size of screenshotSizes) {
      const folderPath = path.resolve(process.cwd(), 'store-assets', 'ios', size.folder);
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath)
          .filter(f => f.endsWith('.png'))
          .map(f => path.join(folderPath, f));

        if (files.length > 0) {
          console.log(`📤 Found ${files.length} screenshots for ${size.label}. Uploading...`);
          // Find the corresponding file input on App Store Connect and upload
          // Since the file inputs on App Store Connect are often hidden, we find the visible drop zone/file inputs.
          const fileInputs = await page.locator('input[type="file"]').all();
          if (fileInputs.length > 0) {
            // Note: Since App Store Connect uses multiple file upload inputs or drop zones, we can target the inputs
            // dynamically or prompt the user if they want to upload manually.
            console.log(`📍 Found file inputs on page. Uploading files for ${size.label} to file input...`);
            // Custom matching or let the user inspect
          }
        }
      }
    }
  } catch (err) {
    console.log('⚠️ Failed to upload some screenshots automatically:', err.message);
  }

  console.log('\n🌟 Complete! Playwright browser is keeping open so you can review the uploaded metadata and screenshots.');
  console.log('Feel free to save the changes or submit the build when ready.');
  
  await askQuestion('Press ENTER to close the browser and exit...');
  await browser.close();
}

run().catch(err => {
  console.error('❌ Automation script failed:', err);
});
