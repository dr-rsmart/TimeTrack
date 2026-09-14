import { test, expect } from '@playwright/test';

test.describe('FAQ help centre', () => {
  test('redirects unauthenticated visitors to login', async ({ page }) => {
    await page.goto('/faq');
    await expect(page).toHaveURL(/.*login/);
  });

  test('authenticated users can open FAQ topics and compare location permissions', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@timetrack.com');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/$|\/dashboard/, { timeout: 10_000 });

    await page.goto('/faq');
    await expect(page.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeVisible();
    await expect(page.getByText('Use Allow all the time / Always for background automatic clocking on mobile.')).toBeVisible();

    const permissionQuestion = page.getByRole('button', {
      name: 'What is the difference between “Allow all the time” / “Always” and “Allow while using the app”?',
    });
    await expect(permissionQuestion).toHaveAttribute('aria-expanded', 'false');
    await permissionQuestion.click();
    await expect(permissionQuestion).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/supports background geofence monitoring/i)).toBeVisible();

    const manualQuestion = page.getByRole('button', { name: 'How do I clock in and clock out manually?' });
    await manualQuestion.click();
    await expect(page.getByText(/Clock In starts one active work session/i)).toBeVisible();
  });
});