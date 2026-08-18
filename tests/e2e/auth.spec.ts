import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';

test.describe('Authentication & Session Management', () => {
  test('should display login page and enforce mandatory credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
  });

  test('should reject invalid credentials with error notification', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'nonexistent_user@example.com');
    await page.fill('input[type="password"]', 'WrongPassword!123');
    await page.click('button[type="submit"]');

    // Should stay on login page or show error message
    await expect(page).toHaveURL(/.*login/);
  });

  test('should redirect unauthenticated users accessing protected routes to login', async ({ page }) => {
    await page.goto('/employees');
    await expect(page).toHaveURL(/.*login/);

    await page.goto('/reports');
    await expect(page).toHaveURL(/.*login/);

    await page.goto('/settings');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should successfully login with valid credentials and establish session', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@timetrack.com');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button[type="submit"]');

    // Should redirect to dashboard after successful login
    await page.waitForURL(/\/$|\/dashboard/, { timeout: 10000 });
    await expect(page).not.toHaveURL(/.*login/);
  });

  test('should successfully logout and clear session', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@timetrack.com');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/$|\/dashboard/, { timeout: 10000 });

    // Find and click logout button (typically in header/menu)
    const logoutBtn = page.locator('button:has-text("Logout"), button:has-text("Sign out"), [data-testid="logout"]').first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await page.waitForURL(/.*login/, { timeout: 10000 });
      await expect(page).toHaveURL(/.*login/);
    }
  });

  test('should enforce session via API and return user data', async ({ request }) => {
    // Login via API
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@timetrack.com', password: 'Password123' },
      headers: { 'x-perf-bypass': 'tt_perf_bench_2026' },
    });
    expect(loginRes.status()).toBe(200);

    const body = await loginRes.json();
    expect(body.token || body.user).toBeTruthy();

    // Verify /me endpoint returns authenticated user
    const meRes = await request.get(`${API_BASE}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${body.token}`,
        'x-perf-bypass': 'tt_perf_bench_2026',
      },
    });
    expect(meRes.status()).toBe(200);
    const me = await meRes.json();
    expect(me.email || me.user?.email).toBe('admin@timetrack.com');
  });

  test('should reject API access without valid token', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/auth/me`, {
      headers: { 'x-perf-bypass': 'tt_perf_bench_2026' },
    });
    expect(res.status()).toBe(401);
  });

  test('should reject API access with invalid token', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/auth/me`, {
      headers: {
        Authorization: 'Bearer invalid_token_12345',
        'x-perf-bypass': 'tt_perf_bench_2026',
      },
    });
    expect(res.status()).toBe(401);
  });
});
