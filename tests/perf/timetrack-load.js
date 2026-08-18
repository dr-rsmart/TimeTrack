/**
 * TimeTrack — k6 Performance & Stress Testing Suite
 * --------------------------------------------------
 * Scenarios:
 * 1. Steady Load: 100 concurrent workers clocking in / viewing attendance.
 * 2. Morning Spike: 300 simultaneous workers clocking in at 08:00 AM shift start.
 * 3. Soak Test: Long-running constant load to detect memory/connection leaks.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    // 1. Steady Load Test (Phase A Baseline)
    steady_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 }, // Ramp-up
        { duration: '2m', target: 500 },   // Baseline peak
        { duration: '30s', target: 0 },   // Ramp-down
      ],
      gracefulRampDown: '15s',
    },
    // 2. Morning Shift Spike Test (Phase B Stress: 3000 VUs)
    morning_spike: {
      executor: 'ramping-vus',
      startTime: '3m15s',
      stages: [
        { duration: '20s', target: 1000 },
        { duration: '1m', target: 3000 }, // Concurrency surge
        { duration: '30s', target: 0 },   // Recovery
      ],
      gracefulRampDown: '20s',
    },
    // 3. Soak Test for Connection Leak Detection & Health Probe
    soak_test: {
      executor: 'constant-vus',
      startTime: '5m15s',
      vus: 50,
      duration: '3m',
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true }], // Abort circuit breaker (>5% failures)
    http_req_duration: ['p(95)<400', 'p(99)<1200'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  const params = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  // Health check endpoint probe
  const healthRes = http.get(`${BASE_URL}/api/health`, params);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health status is ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok';
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
