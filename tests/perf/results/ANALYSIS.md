# TimeTrack — k6 Stress Test Analysis Report

**Generated:** 2026-08-18T16:34:51.964Z
**Source:** `c:\Users\Ricardo Smart\Desktop\TimeTrack\tests\perf\results`

## SLA Gates

| Gate | Threshold |
|------|-----------|
| p99 latency | < 3000ms (abort trigger) |
| p95 latency | < 1500ms |
| Error rate | < 5% (abort trigger) |
| Check pass rate | ≥ 95% |

## phase-A-protocol — ✅ PASSED

| Metric | Value |
|--------|-------|
| Total requests | 17081 |
| Peak VUs | 100 |
| Throughput | 23.7 req/s |
| p50 latency | — |
| p90 latency | 2.77s |
| p95 latency | 4.94s |
| p99 latency | — |
| Error rate | 2.03% |
| Check pass rate | 100.00% |

### SLA Evaluation

| Gate | Observed | Verdict |
|------|----------|---------|
| p95 < 1500ms (warning) | 4.94s | ⚠️ WARN |
| error rate < 5% (ABORT) | 2.03% | ✅ PASS |
| check pass ≥ 95% (ABORT) | 100.00% | ✅ PASS |

### Custom Duration Trends

| Metric | p50 | p95 | p99 |
|--------|-----|-----|-----|
| tt_login_duration | 2.50s | 4.94s | — |
| tt_clock_out_duration | 11ms | 1.10s | — |
| tt_health_duration | 0ms | 1ms | — |
| tt_clock_in_duration | 15ms | 35ms | — |
| tt_dashboard_duration | 88ms | 174ms | — |
| tt_sse_handshake_duration | 3.00s | 3.00s | — |
| tt_db_query_duration | 105ms | 203ms | — |

## protocol-smoke — ✅ PASSED

| Metric | Value |
|--------|-------|
| Total requests | 3541 |
| Peak VUs | 10 |
| Throughput | 9.8 req/s |
| p50 latency | — |
| p90 latency | 383ms |
| p95 latency | 543ms |
| p99 latency | — |
| Error rate | 0.88% |
| Check pass rate | 100.00% |

### SLA Evaluation

| Gate | Observed | Verdict |
|------|----------|---------|
| p95 < 1500ms (warning) | 543ms | ✅ PASS |
| error rate < 5% (ABORT) | 0.88% | ✅ PASS |
| check pass ≥ 95% (ABORT) | 100.00% | ✅ PASS |

### Custom Duration Trends

| Metric | p50 | p95 | p99 |
|--------|-----|-----|-----|
| tt_db_query_duration | 10ms | 15ms | — |
| tt_health_duration | 1ms | 1ms | — |
| tt_login_duration | 328ms | 543ms | — |
| tt_sse_handshake_duration | 3.00s | 3.00s | — |
| tt_dashboard_duration | 6ms | 9ms | — |

---

## Overall Verdict: ✅ ALL PHASES PASSED
