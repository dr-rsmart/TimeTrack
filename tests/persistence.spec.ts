import { test, expect } from '@playwright/test';

test.describe('Data Integrity & Persistence', () => {
  test('should persist all fields correctly in the database', async ({ page, request }) => {
    await page.goto('http://localhost:4001/');
    
    // Clear existing entries first to have a clean slate
    const entries = await (await request.get('http://localhost:5001/api/TimeEntry')).json();
    for (const entry of entries) {
      await request.delete(`http://localhost:5001/api/TimeEntry/${entry.id}`);
    }

    // 1. Clock In
    await page.click('button:has-text("Clock In")');
    await expect(page.locator('text=Clock Out')).toBeVisible();

    // 2. Fetch from DB and verify all fields
    const response = await request.get('http://localhost:5001/api/TimeEntry');
    const dbEntries = await response.json();
    expect(dbEntries.length).toBe(1);
    
    const entry = dbEntries[0];
    expect(entry.employee_email).toBe('admin@example.com');
    expect(entry.employee_name).toBe('Admin User');
    expect(entry.status).toBe('clocked_in');
    expect(new Date(entry.clock_in).getTime()).toBeLessThan(Date.now());
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.clocked_by_id).toBeNull(); // Since it's self-clock

    // 3. Refresh page and ensure state persists in UI
    await page.reload();
    await expect(page.locator('text=Clock Out')).toBeVisible();
    
    // 4. Clock Out
    await page.click('button:has-text("Clock Out")');
    await expect(page.locator('text=Clock In')).toBeVisible();

    // 5. Verify DB update
    const finalResponse = await request.get('http://localhost:5001/api/TimeEntry');
    const finalEntries = await finalResponse.json();
    const updatedEntry = finalEntries[0];
    
    expect(updatedEntry.status).toBe('completed');
    expect(updatedEntry.clock_out).not.toBeNull();
    expect(updatedEntry.total_hours).toBeGreaterThanOrEqual(0);
    
    console.log('Data integrity and persistence verified!');
  });
});
