import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const APPLE_ID = process.env.iOS_Build_Credentials || 'ricardovsmart@gmail.com';
const APPLE_PWD = process.env.iOS_Build_Password || 'RicJer24';
const APP_ID = '6803827296';
const TARGET_URL = `https://appstoreconnect.apple.com/apps/${APP_ID}/appstore/ios/version/deliverable`;

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function run() {
  console.log('🚀 Launching visible Chromium browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  console.log(`🌐 Navigating to TimeTrack App Store version page: ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n======================================================');
  console.log('🟢 Chromium browser window is open!');
  console.log('👉 If prompted, complete your Apple ID sign-in / 2FA.');
  console.log('👉 Once on the TimeTrack deliverable page:');
  console.log('   1. Scroll to the "Build" section.');
  console.log('   2. Click "+ Add Build" / "Choose a build" to select the build.');
  console.log('   3. Click the blue "Add for Review" / "Submit for Review" button at the top right.');
  console.log('======================================================');
  console.log('The browser will remain open until you close it or press ENTER here.');

  await askQuestion('\n👉 Press ENTER here when you are done to exit and close the browser... ');
  await browser.close();
}

run().catch((e) => {
  console.error('❌ Error:', e);
});