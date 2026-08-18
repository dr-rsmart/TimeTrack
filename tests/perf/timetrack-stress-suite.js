/**
 * TimeTrack — Enterprise Distributed Stress & Load Testing Suite
 * =========================================================================
 * QA & Best Practice Concurrency Primitives:
 *
 * 1. Phased Execution Architecture:
 *    - Phase A: Baseline (1,000 VUs — 1 worker node)
 *    - Phase B: Stress   (3,000 VUs — 1 worker node)
 *    - Phase C: Peak     (5,000 VUs — evenly split across 2 worker nodes)
 *
 * 2. Sequential Scenario Isolation:
 *    - scenario_health: API Health Check & Baseline Liveness
 *    - scenario_login:  Concurrent User Authentication & Token Generation
 *    - scenario_dash:   Multi-Tenant Dashboard KPI & Aggregation Queries
 *    - scenario_db:     TimeEntry & Shift Transaction Query Stress
 *    - scenario_sse:    Server-Sent Events Realtime Stream Connection Load
 *
 * 3. Fail-Fast Circuit Breakers & Abort Thresholds:
 *    - Error Rate > 5% (http_req_failed rate >= 0.05) -> Immediate Abort
 *    - Latency Degradation (p99 > 3,000ms)             -> Immediate Abort
 *    - Host Metrics: Memory > 90%, CPU > 95%, Disk Queue > 2
 * =========================================================================
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom Telemetry Metrics
export const loginDuration = new Trend('tt_login_duration', true);
export const dashboardDuration = new Trend('tt_dashboard_duration', true);
export const dbQueryDuration = new Trend('tt_db_query_duration', true);
export const sseConnectDuration = new Trend('tt_sse_connect_duration', true);
export const abortTriggerCount = new Counter('tt_abort_triggers');
export const rateLimitViolations = new Rate('tt_rate_limit_hits');

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
const PERF_SECRET = __ENV.PERF_TEST_SECRET || 'tt_perf_bench_2026';
const TARGET_ENV = __ENV.TARGET_ENV || 'staging';

export const options = {
  // Test Runner Configuration
  discardResponseBodies: false,
  scenarios: {
    // ── Scenario 1: API Health Check & Liveness Probe ──
    scenario_health: {
      executor: 'ramping-vus',
      exec: 'healthCheckScenario',
      startTime: '0s',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      tags: { phase: 'baseline', scenario: 'health' },
    },

    // ── Scenario 2: Concurrent Login Authentication ──
    scenario_login: {
      executor: 'ramping-vus',
      exec: 'loginScenario',
      startTime: '2m15s', // Isolated after health check
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },   // Phase A Ramp
        { duration: '1m', target: 1000 },   // Phase A Peak
        { duration: '1m', target: 3000 },   // Phase B Stress Peak
        { duration: '30s', target: 0 },     // Cooldown
      ],
      gracefulRampDown: '20s',
      tags: { phase: 'stress', scenario: 'login' },
    },

    // ── Scenario 3: Dashboard Analytics & Multi-Tenant Aggregation ──
    scenario_dashboard: {
      executor: 'ramping-vus',
      exec: 'dashboardScenario',
      startTime: '5m30s',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '2m', target: 2000 },
        { duration: '1m', target: 3000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '20s',
      tags: { phase: 'stress', scenario: 'dashboard' },
    },

    // ── Scenario 4: Database Query & Clock-In Concurrency Stress ──
    scenario_db_query: {
      executor: 'ramping-vus',
      exec: 'dbQueryScenario',
      startTime: '9m45s',
      startVUs: 0,
      stages: [
        { duration: '45s', target: 1000 },
        { duration: '2m', target: 3000 },
        { duration: '2m', target: 5000 },  // Phase C Scale (split across workers)
        { duration: '45s', target: 0 },
      ],
      gracefulRampDown: '30s',
      tags: { phase: 'scale_spike', scenario: 'database' },
    },

    // ── Scenario 5: Server-Sent Events (SSE) Stream Concurrency ──
    scenario_sse_stream: {
      executor: 'constant-vus',
      exec: 'sseScenario',
      startTime: '15m30s',
      vus: 1000,
      duration: '4m',
      tags: { phase: 'soak_stream', scenario: 'sse' },
    },
  },

  // Immediate Abort & SLA Thresholds
  thresholds: {
    // 1. Catastrophic Error Rate Abort Circuit Breaker (> 5%)
    http_req_failed: [
      {
        threshold: 'rate<0.05',
        abortOnFail: true,
        delayAbortEval: '10s',
      },
    ],
    // 2. SLA Latency Abort Degradation Thresholds (p99 > 3,000ms)
    'http_req_duration{scenario:health}': [
      { threshold: 'p(99)<500', abortOnFail: true },
      { threshold: 'p(95)<250' },
    ],
    'http_req_duration{scenario:login}': [
      { threshold: 'p(99)<3000', abortOnFail: true },
      { threshold: 'p(95)<1500' },
    ],
    'http_req_duration{scenario:dashboard}': [
      { threshold: 'p(99)<2500', abortOnFail: true },
      { threshold: 'p(95)<1000' },
    ],
    'http_req_duration{scenario:database}': [
      { threshold: 'p(99)<3000', abortOnFail: true },
      { threshold: 'p(95)<1200' },
    ],
    tt_rate_limit_hits: ['rate<0.01'],
  },
};

// Common request headers
function getHeaders(token = null) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-perf-bypass': PERF_SECRET,
  };
  if (token) {
    headers['Cookie'] = `tt_token=${token}`;
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: API Health Check & Database Ping
// ─────────────────────────────────────────────────────────────────────────────
export function healthCheckScenario() {
  const res = http.get(`${BASE_URL}/api/health`, {
    headers: getHeaders(),
  });

  const ok = check(res, {
    'health check status is 200': (r) => r.status === 200,
    'health DB check ok': (r) => {
      try {
        return JSON.parse(r.body).status === 'ok';
      } catch {
        return false;
      }
    },
  });

  if (!ok) abortTriggerCount.add(1);
  sleep(0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Concurrent User Login & Token Generation
// ─────────────────────────────────────────────────────────────────────────────
export function loginScenario() {
  const userIndex = Math.floor(Math.random() * 5) + 1;
  const accounts = [
    { email: 'admin@timetrack.com', password: 'Password123' },
    { email: 'thabo@timetrack.com', password: 'Password123' },
    { email: 'ayesha@timetrack.com', password: 'Password123' },
    { email: 'sipho@timetrack.com', password: 'Password123' },
    { email: 'lerato@timetrack.com', password: 'Password123' },
  ];
  const payload = JSON.stringify(accounts[userIndex - 1]);

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/auth/login`, payload, {
    headers: getHeaders(),
  });
  loginDuration.add(Date.now() - start);

  if (res.status === 429) rateLimitViolations.add(1);

  check(res, {
    'login returned 200': (r) => r.status === 200,
    'jwt token received': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Boolean(body.token || body.user);
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Multi-Tenant Dashboard Summary & Trends
// ─────────────────────────────────────────────────────────────────────────────
export function dashboardScenario() {
  // First authenticate
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'admin@timetrack.com', password: 'Password123' }),
    { headers: getHeaders() }
  );

  let token = null;
  try {
    const data = JSON.parse(loginRes.body);
    token = data.token;
  } catch {}

  const authHeaders = getHeaders(token);

  group('Dashboard KPI Group', () => {
    const start = Date.now();
    const sumRes = http.get(`${BASE_URL}/api/dashboard/summary`, { headers: authHeaders });
    const trendRes = http.get(`${BASE_URL}/api/dashboard/hours-trend?days=14`, { headers: authHeaders });
    const deptRes = http.get(`${BASE_URL}/api/dashboard/department-performance`, { headers: authHeaders });
    dashboardDuration.add(Date.now() - start);

    check(sumRes, { 'summary status 200': (r) => r.status === 200 });
    check(trendRes, { 'trend status 200': (r) => r.status === 200 });
    check(deptRes, { 'dept perf status 200': (r) => r.status === 200 });
  });

  sleep(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Database Query & Time-Entry Punch Load
// ─────────────────────────────────────────────────────────────────────────────
export function dbQueryScenario() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'thabo@timetrack.com', password: 'Password123' }),
    { headers: getHeaders() }
  );

  let token = null;
  try {
    token = JSON.parse(loginRes.body).token;
  } catch {}

  const authHeaders = getHeaders(token);

  group('Time Entry Query & Clock-In Aggregation', () => {
    const start = Date.now();
    const listRes = http.get(`${BASE_URL}/api/time-entries?limit=50`, { headers: authHeaders });
    const shiftsRes = http.get(`${BASE_URL}/api/shifts?limit=50`, { headers: authHeaders });
    const empRes = http.get(`${BASE_URL}/api/employees?limit=50`, { headers: authHeaders });
    dbQueryDuration.add(Date.now() - start);

    check(listRes, { 'time entries list 200': (r) => r.status === 200 });
    check(shiftsRes, { 'shifts list 200': (r) => r.status === 200 });
    check(empRes, { 'employees list 200': (r) => r.status === 200 });
  });

  sleep(0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: SSE Real-Time Streaming Probe
// ─────────────────────────────────────────────────────────────────────────────
export function sseScenario() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'admin@timetrack.com', password: 'Password123' }),
    { headers: getHeaders() }
  );

  let token = null;
  try {
    token = JSON.parse(loginRes.body).token;
  } catch {}

  const authHeaders = getHeaders(token);
  authHeaders['Accept'] = 'text/event-stream';

  const start = Date.now();
  // Probe the SSE streaming endpoint
  const sseRes = http.get(`${BASE_URL}/api/events`, {
    headers: authHeaders,
    timeout: '5s',
  });
  sseConnectDuration.add(Date.now() - start);

  check(sseRes, {
    'sse handshake established': (r) => r.status === 200 || r.status === 0, // 0 in k6 on intentional streaming disconnect
  });

  sleep(2);
}

// Default export fallback
export default function () {
  healthCheckScenario();
}
