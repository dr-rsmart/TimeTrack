import { describe, it, expect } from 'vitest';
import { recordHttpRequest, getMetricSnapshot, renderMetrics } from '../../server/src/metrics';

describe('Prometheus Metrics Module', () => {
  it('counts requests by status class and errors', () => {
    const before = getMetricSnapshot();

    recordHttpRequest(200);
    recordHttpRequest(301);
    recordHttpRequest(404);
    recordHttpRequest(500);
    recordHttpRequest(503);

    const after = getMetricSnapshot();
    expect(after.httpRequestsTotal - before.httpRequestsTotal).toBe(5);
    expect(after.httpErrorsTotal - before.httpErrorsTotal).toBe(2);
    expect(after.httpByStatusClass['2xx'] - before.httpByStatusClass['2xx']).toBe(1);
    expect(after.httpByStatusClass['3xx'] - before.httpByStatusClass['3xx']).toBe(1);
    expect(after.httpByStatusClass['4xx'] - before.httpByStatusClass['4xx']).toBe(1);
    expect(after.httpByStatusClass['5xx'] - before.httpByStatusClass['5xx']).toBe(2);
  });

  it('exposes uptime and monotonic totals in the snapshot', () => {
    const snap = getMetricSnapshot();
    expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(snap.httpRequestsTotal).toBeGreaterThanOrEqual(0);
  });

  it('renders valid Prometheus text format with HELP/TYPE pairs', () => {
    const body = renderMetrics([
      { name: 'sse_active_clients', help: 'Connected SSE clients.', type: 'gauge', value: 3 },
    ]);

    expect(body).toContain('# HELP http_requests_total');
    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toContain('# HELP process_uptime_seconds');
    expect(body).toContain('# TYPE sse_active_clients gauge');
    expect(body).toContain('sse_active_clients 3');
    expect(body.endsWith('\n')).toBe(true);
  });

  it('renders status-class labels for scraped histograms', () => {
    const body = renderMetrics();
    expect(body).toContain('http_responses_total{class="2xx"}');
    expect(body).toContain('http_responses_total{class="5xx"}');
  });
});
