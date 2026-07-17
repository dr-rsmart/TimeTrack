import { test, expect } from '@playwright/test';

test('should clock in and update the database', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  // 1. Navigate to the dashboard
  await page.goto('/');
  
  // Check if we are on the dashboard (wait for some element)
  await expect(page.locator('text=Clock In')).toBeVisible();

  // 2. Capture initial state of the database
  const initialResponse = await page.request.get('http://localhost:5001/api/TimeEntry');
  const initialEntries = await initialResponse.json();
  const initialCount = initialEntries.length;

  console.log(`Initial entries in DB: ${initialCount}`);

  // 3. Click Clock In
  await page.click('button:has-text("Clock In")');

  // 4. Verify UI update (Realtime change)
  // The button should change to "Clock Out"
  await expect(page.locator('text=Clock Out')).toBeVisible({ timeout: 10000 });
  
  // 5. Verify database update
  const finalResponse = await page.request.get('http://localhost:5001/api/TimeEntry');
  const finalEntries = await finalResponse.json();
  const finalCount = finalEntries.length;

  console.log(`Final entries in DB: ${finalCount}`);
  
  expect(finalCount).toBe(initialCount + 1);

  // Verify the latest entry matches our user (admin@example.com)
  const latestEntry = finalEntries[finalEntries.length - 1];
  expect(latestEntry.employee_email).toBe('admin@example.com');
  expect(latestEntry.status).toBe('clocked_in');

  // 6. Clock Out
  await page.click('button:has-text("Clock Out")');
  await expect(page.locator('text=Clock In')).toBeVisible({ timeout: 10000 });

  // Verify database update for clock out
  const afterOutResponse = await page.request.get('http://localhost:5001/api/TimeEntry');
  const afterOutEntries = await afterOutResponse.json();
  const updatedEntry = afterOutEntries.find(e => e.id === latestEntry.id);
  expect(updatedEntry.status).toBe('completed');
  expect(updatedEntry.clock_out).not.toBeNull();
});
