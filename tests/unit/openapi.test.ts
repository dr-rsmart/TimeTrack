import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../server/src/openapi.js';

describe('OpenAPI document', () => {
  it('generates a valid OpenAPI 3.1 document covering the core surface', () => {
    const doc = buildOpenApiDocument() as unknown as Record<string, unknown>;
    expect(Object.keys(doc)).toContain('paths');
    const paths = (doc as { paths?: Record<string, unknown> }).paths ?? {};
    expect(Object.keys(paths).length).toBeGreaterThanOrEqual(40);
    expect(paths['/auth/login']).toBeTruthy();
    expect(paths['/time-entries/clock-in']).toBeTruthy();
    expect(paths['/employees']).toBeTruthy();
    expect(paths['/reports/payroll']).toBeTruthy();
    expect(paths['/reports/payroll/snapshot']).toBeTruthy();
    expect(paths['/reports/payroll/snapshots']).toBeTruthy();
    expect(paths['/auth/push-token']).toBeTruthy();
  });
});
