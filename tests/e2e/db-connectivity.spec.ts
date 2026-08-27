import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:4000';

test.describe('Database Connectivity & Health Check', () => {
  test('should return 200 and healthy database status from /api/health', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/health`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.timestamp).toBeDefined();
  });

  test('should reject invalid endpoint under /api with 404', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/non-existent-probe-route`);
    expect(res.status()).toBe(404);
  });
});
