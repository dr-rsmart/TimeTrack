/**
 * TimeTrack Enterprise Stress Testing Suite — Up to 5,000 Virtual Users (VUs)
 * =========================================================================
 * Tests multi-tenant workforce workflows under concurrency scaling up to 5,000 VUs:
 * - Phase 1: API Health Check & Baseline Liveness Probe (1,000 VUs)
 * - Phase 2: Concurrent Multi-Role Authentication (100 VUs)
 * - Phase 3: Dashboard Analytics & Multi-Tenant Aggregations (2,000 VUs)
 * - Phase 4: Peak 5,000 VUs Concurrency Stress
 * =========================================================================
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom Metrics
export const loginDuration = new Trend('tt_login_duration', true);
export const dashboardDuration = new Trend('tt_dashboard_duration', true);
export const peakDuration = new Trend('tt_peak5000_duration', true);
export const errorRate = new Rate('tt_custom_errors');

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
const PERF_SECRET = __ENV.PERF_TEST_SECRET || 'tt_perf_bench_2026';

export const options = {
  scenarios: {
    // ── Phase 1: Baseline Liveness & Health (1,000 VUs) ──
    baseline_health: {
      executor: 'ramping-vus',
      exec: 'healthScenario',
      startTime: '0s',
      startVUs: 10,
      stages: [
        { duration: '5s', target: 500 },
        { duration: '10s', target: 1000 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },

    // ── Phase 2: Concurrent Multi-Role Authentication ──
    multi_role_auth: {
      executor: 'ramping-vus',
      exec: 'loginScenario',
      startTime: '25s',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 50 },
        { duration: '10s', target: 100 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },

    // ── Phase 3: Dashboard Analytics Aggregations (2,000 VUs) ──
    dashboard_stress: {
      executor: 'ramping-vus',
      exec: 'dashboardScenario',
      startTime: '50s',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 500 },
        { duration: '10s', target: 2000 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },

    // ── Phase 4: Peak 5,000 VUs Concurrency Stress ──
    peak_stress_5000vu: {
      executor: 'ramping-vus',
      exec: 'peak5000Scenario',
      startTime: '75s',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 2000 },
        { duration: '15s', target: 5000 }, // Concurrency Surge to 5,000 VUs!
        { duration: '15s', target: 5000 }, // Peak Load
        { duration: '10s', target: 0 },    // Cooldown
      ],
      gracefulRampDown: '10s',
    },
  },

  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true }],
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
  },
};

function getHeaders(token = null) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Connection: 'keep-alive',
    'x-perf-bypass': PERF_SECRET,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['Cookie'] = `tt_token=${token}`;
  }
  return headers;
}

// Setup: Pre-authenticate to obtain reusable JWT tokens for high-concurrency phases
export function setup() {
  const accounts = [
    { email: 'master@smartpatel.co.za', password: 'Password123' },
    { email: 'admin@timetrack.com', password: 'Password123' },
    { email: 'thabo@timetrack.com', password: 'Password123' },
    { email: 'sipho@timetrack.com', password: 'Password123' },
  ];

  const tokens = {};
  for (const acc of accounts) {
    const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify(acc), {
      headers: getHeaders(),
    });
    try {
      const data = JSON.parse(res.body);
      tokens[acc.email] = data.token;
    } catch {}
  }

  return { tokens };
}

// ── Scenario 1: Health Probe ──
export function healthScenario() {
  const res = http.get(`${BASE_URL}/api/health`, { headers: getHeaders() });
  const ok = check(res, {
    'health check status is 200': (r) => r.status === 200,
  });
  if (!ok) errorRate.add(1);
  sleep(0.3);
}

// ── Scenario 2: Multi-Role Auth ──
export function loginScenario() {
  const accounts = [
    { email: 'master@smartpatel.co.za', password: 'Password123' },
    { email: 'admin@timetrack.com', password: 'Password123' },
    { email: 'thabo@timetrack.com', password: 'Password123' },
    { email: 'ayesha@timetrack.com', password: 'Password123' },
    { email: 'sipho@timetrack.com', password: 'Password123' },
  ];
  const target = accounts[Math.floor(Math.random() * accounts.length)];

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(target),
    { headers: getHeaders() }
  );
  loginDuration.add(Date.now() - start);

  const ok = check(res, {
    'login status 200': (r) => r.status === 200,
    'jwt received': (r) => {
      try {
        return Boolean(JSON.parse(r.body).token);
      } catch {
        return false;
      }
    },
  });
  if (!ok) errorRate.add(1);
  sleep(0.5);
}

// ── Scenario 3: Dashboard Analytics Aggregations ──
export function dashboardScenario(data) {
  const token = data?.tokens?.['admin@timetrack.com'];
  const authHeaders = getHeaders(token);

  group('Dashboard Aggregations', () => {
    const start = Date.now();
    const sumRes = http.get(`${BASE_URL}/api/dashboard/summary`, { headers: authHeaders });
    const trendRes = http.get(`${BASE_URL}/api/dashboard/hours-trend?days=14`, { headers: authHeaders });
    dashboardDuration.add(Date.now() - start);

    const ok = check(sumRes, { 'summary status 200': (r) => r.status === 200 }) &&
               check(trendRes, { 'trend status 200': (r) => r.status === 200 });

    if (!ok) errorRate.add(1);
  });

  sleep(0.5);
}

// ── Scenario 4: Peak 5,000 VUs Concurrency Stress ──
export function peak5000Scenario(data) {
  const token = data?.tokens?.['admin@timetrack.com'];
  const authHeaders = getHeaders(token);

  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/health`, { headers: authHeaders });
  peakDuration.add(Date.now() - start);

  const ok = check(res, { 'peak 5000 VU health 200': (r) => r.status === 200 });

  if (!ok) errorRate.add(1);

  sleep(1.0);
}

// Default export fallback
export default function () {
  healthScenario();
}
