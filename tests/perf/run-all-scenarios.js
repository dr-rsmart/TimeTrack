import http from 'k6/http';
import { check, sleep, group } from 'k6';

export const options = {
  scenarios: {
    health: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5s',
      exec: 'healthScenario',
    },
    login: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5s',
      startTime: '6s',
      exec: 'loginScenario',
    },
    dashboard: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5s',
      startTime: '12s',
      exec: 'dashboardScenario',
    },
    db_query: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5s',
      startTime: '18s',
      exec: 'dbScenario',
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true }],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
const PERF_SECRET = __ENV.PERF_TEST_SECRET || 'tt_perf_bench_2026';

function headers(token = null) {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-perf-bypass': PERF_SECRET,
  };
  if (token) {
    h['Cookie'] = `tt_token=${token}`;
    h['Authorization'] = `Bearer ${token}`;
  }
  return h;
}

export function healthScenario() {
  const res = http.get(`${BASE_URL}/api/health`, { headers: headers() });
  check(res, {
    'health 200': (r) => r.status === 200,
    'health ok': (r) => {
      try { return JSON.parse(r.body).status === 'ok'; } catch { return false; }
    },
  });
  sleep(0.2);
}

export function loginScenario() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'admin@timetrack.com', password: 'Password123' }),
    { headers: headers() }
  );
  check(res, {
    'login 200': (r) => r.status === 200,
  });
  sleep(0.5);
}

export function dashboardScenario() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'admin@timetrack.com', password: 'Password123' }),
    { headers: headers() }
  );
  let token = null;
  try { token = JSON.parse(loginRes.body).token; } catch {}

  const h = headers(token);
  const sum = http.get(`${BASE_URL}/api/dashboard/summary`, { headers: h });
  const trend = http.get(`${BASE_URL}/api/dashboard/hours-trend?days=7`, { headers: h });

  check(sum, { 'summary 200': (r) => r.status === 200 });
  check(trend, { 'trend 200': (r) => r.status === 200 });
  sleep(0.5);
}

export function dbScenario() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'thabo@timetrack.com', password: 'Password123' }),
    { headers: headers() }
  );
  let token = null;
  try { token = JSON.parse(loginRes.body).token; } catch {}

  const h = headers(token);
  const te = http.get(`${BASE_URL}/api/time-entries?limit=20`, { headers: h });
  const sh = http.get(`${BASE_URL}/api/shifts?limit=20`, { headers: h });

  check(te, { 'time entries 200': (r) => r.status === 200 });
  check(sh, { 'shifts 200': (r) => r.status === 200 });
  sleep(0.5);
}
