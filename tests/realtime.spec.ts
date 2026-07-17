import { test, expect } from '@playwright/test';

test.describe('Realtime Synchronization', () => {
  test('should sync data across two browser contexts', async ({ browser }) => {
    // 1. Setup two independent browser contexts (like two different users/tabs)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // 2. Navigate both to the dashboard
    await page1.goto('http://localhost:4001/');
    await page2.goto('http://localhost:4001/');

    // Ensure both are loaded
    await expect(page1.locator('text=Clock In')).toBeVisible();
    await expect(page2.locator('text=Clock In')).toBeVisible();

    // 3. Perform action on Page 1 (Clock In)
    await page1.click('button:has-text("Clock In")');

    // 4. Verify Page 1 updated (local state/SSE)
    await expect(page1.locator('text=Clock Out')).toBeVisible({ timeout: 10000 });

    // 5. Verify Page 2 updated AUTOMATICALLY (Cross-client Realtime via SSE)
    // This is the critical test for 99.9% confidence
    await expect(page2.locator('text=Clock Out')).toBeVisible({ timeout: 15000 });

    console.log('Real-time sync verified across contexts!');

    // 6. Perform action on Page 2 (Clock Out)
    await page2.click('button:has-text("Clock Out")');

    // 7. Verify Page 2 updated
    await expect(page2.locator('text=Clock In')).toBeVisible({ timeout: 10000 });

    // 8. Verify Page 1 updated AUTOMATICALLY
    await expect(page1.locator('text=Clock In')).toBeVisible({ timeout: 15000 });

    console.log('Bidirectional real-time sync verified!');

    await context1.close();
    await context2.close();
  });
});
