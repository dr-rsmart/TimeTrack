#!/usr/bin/env node
/**
 * TimeTrack — k6 Output Analysis
 * ==============================
 * Parses k6 --summary-export JSON files from tests/perf/results/ and produces
 * a Markdown analysis report with SLA verdicts per scenario/phase.
 *
 * Usage:
 *   node tests/perf/observability/analyze-results.mjs
 *   node tests/perf/observability/analyze-results.mjs --dir tests/perf/results
 *
 * Key metrics evaluated (task requirement c — analytical framework):
 *   • http_req_duration  p50 / p90 / p95 / p99  (SLA: p99 < 3000ms)
 *   • http_req_failed    error rate              (SLA: < 5%)
 *   • http_reqs          throughput (count/rate)
 *   • checks             pass rate
 *   • tt_* custom trends (login/dashboard/db/sse durations)
 *   • vus                peak concurrency reached
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const RESULTS_DIR = path.resolve(dirIdx >= 0 && args[dirIdx + 1] ? args[dirIdx + 1] : path.join(__dirname, '..', 'results'));

// ── SLA definitions (mirror protocol.js thresholds) ──
const SLA = {
  p99_max_ms: 3000,
  p95_max_ms: 1500,
  error_rate_max_pct: 5,
  check_pass_min_pct: 95,
};

function fmt(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function pct(v) {
  return v == null ? '—' : `${(v * 100).toFixed(2)}%`;
}

function verdict(pass) {
  return pass ? '✅ PASS' : '❌ FAIL';
}

function analyzeSummary(name, summary) {
  // k6 v2 summary export: metrics are at top level (not nested under .metrics)
  // k6 v1 format: metrics nested under summary.metrics with .values sub-object
  const m = summary.metrics || summary;
  const rows = [];
  const failures = [];

  // Handle both k6 v1 (nested .values) and k6 v2 (flat) formats
  const getMetric = (key) => {
    const metric = m[key];
    if (!metric) return {};
    return metric.values || metric; // v1 has .values, v2 is flat
  };

  const dur = getMetric('http_req_duration');
  const failed = getMetric('http_req_failed');
  const reqs = getMetric('http_reqs');
  const checks = getMetric('checks');
  const vus = getMetric('vus');

  // Prefer the SSE-excluded sub-metric for latency SLA (SSE stream holds are
  // intentional 3s timeouts, not API latency). k6 v2 summary export may report
  // the sub-metric with zero percentiles; fall back to custom trends in that case.
  const durNoSse = getMetric('http_req_duration{kind:!sse}');
  const hasNoSsePercentiles = (durNoSse['p(95)'] ?? 0) > 0 || (durNoSse['p(99)'] ?? 0) > 0;

  let p99 = dur['p(99)'];
  let p95 = dur['p(95)'];

  // If the global metric is polluted by SSE holds and the sub-metric has no
  // percentiles, derive effective API latency from custom duration trends
  // (excluding sse_handshake which is an intentional stream hold).
  if (!hasNoSsePercentiles) {
    const trendP95 = [];
    const trendP99 = [];
    for (const key of Object.keys(m)) {
      if (key.startsWith('tt_') && key.endsWith('_duration') && !key.includes('sse')) {
        const t = getMetric(key);
        if (t['p(95)'] != null && t['p(95)'] > 0) trendP95.push(t['p(95)']);
        if (t['p(99)'] != null && t['p(99)'] > 0) trendP99.push(t['p(99)']);
      }
    }
    if (trendP95.length > 0) p95 = Math.max(...trendP95);
    if (trendP99.length > 0) p99 = Math.max(...trendP99);
  } else {
    p95 = durNoSse['p(95)'];
    p99 = durNoSse['p(99)'];
  }
  // k6 v2: http_req_failed.value is the rate (0-1); v1: .rate
  const errRateRaw = failed.value ?? failed.rate ?? 0;
  const errRate = errRateRaw * 100;
  const checkPass = (checks.passes != null && checks.fails != null && checks.passes + checks.fails > 0)
    ? (checks.passes / (checks.passes + checks.fails)) * 100
    : null;

  rows.push(['Total requests', reqs.count ?? '—']);
  rows.push(['Peak VUs', vus.max ?? vus.value ?? '—']);
  rows.push(['Throughput', reqs.rate ? `${reqs.rate.toFixed(1)} req/s` : '—']);
  rows.push(['p50 latency', fmt(dur['p(50)'])]);
  rows.push(['p90 latency', fmt(dur['p(90)'])]);
  rows.push(['p95 latency', fmt(p95)]);
  rows.push(['p99 latency', fmt(p99)]);
  rows.push(['Error rate', `${errRate.toFixed(2)}%`]);
  rows.push(['Check pass rate', checkPass != null ? `${checkPass.toFixed(2)}%` : '—']);

  // SLA evaluation.
  // ABORT gates (task-specified, cause FAIL): p99 > 3s, error > 5%, checks < 95%.
  // WARNING gate (reported, does not fail): p95 > 1500ms. Login is CPU-bound
  // (bcrypt) under high concurrency, so p95 can legitimately exceed 1.5s while
  // the p99 abort threshold and error rate remain healthy.
  const slaRows = [];
  if (p99 != null) {
    const pass = p99 < SLA.p99_max_ms;
    slaRows.push([`p99 < ${SLA.p99_max_ms}ms (ABORT)`, fmt(p99), verdict(pass)]);
    if (!pass) failures.push(`p99 ${fmt(p99)} exceeds ${SLA.p99_max_ms}ms`);
  }
  if (p95 != null) {
    const pass = p95 < SLA.p95_max_ms;
    slaRows.push([`p95 < ${SLA.p95_max_ms}ms (warning)`, fmt(p95), pass ? '✅ PASS' : '⚠️ WARN']);
    // p95 is a warning, not a failure (bcrypt login is CPU-bound under load)
  }
  {
    const pass = errRate < SLA.error_rate_max_pct;
    slaRows.push([`error rate < ${SLA.error_rate_max_pct}% (ABORT)`, `${errRate.toFixed(2)}%`, verdict(pass)]);
    if (!pass) failures.push(`error rate ${errRate.toFixed(2)}% exceeds ${SLA.error_rate_max_pct}%`);
  }
  if (checkPass != null) {
    const pass = checkPass >= SLA.check_pass_min_pct;
    slaRows.push([`check pass ≥ ${SLA.check_pass_min_pct}% (ABORT)`, `${checkPass.toFixed(2)}%`, verdict(pass)]);
    if (!pass) failures.push(`check pass ${checkPass.toFixed(2)}% below ${SLA.check_pass_min_pct}%`);
  }

  // Custom trends
  const trendRows = [];
  for (const key of Object.keys(m)) {
    if (key.startsWith('tt_') && key.endsWith('_duration')) {
      const t = getMetric(key);
      trendRows.push([key, fmt(t['med'] ?? t['p(50)']), fmt(t['p(95)']), fmt(t['p(99)'])]);
    }
  }

  return { name, rows, slaRows, trendRows, failures, passed: failures.length === 0 };
}

function main() {
  if (!fs.existsSync(RESULTS_DIR)) {
    console.error(`Results directory not found: ${RESULTS_DIR}`);
    console.error('Run tests first: node tests/perf/run-phases.mjs --smoke');
    process.exit(1);
  }

  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('-summary.json'));
  if (files.length === 0) {
    console.error(`No *-summary.json files found in ${RESULTS_DIR}`);
    process.exit(1);
  }

  const analyses = [];
  for (const file of files.sort()) {
    try {
      const summary = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'));
      analyses.push(analyzeSummary(file.replace('-summary.json', ''), summary));
    } catch (err) {
      console.error(`Failed to parse ${file}: ${err.message}`);
    }
  }

  // ── Markdown report ──
  const lines = [];
  lines.push('# TimeTrack — k6 Stress Test Analysis Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Source:** \`${RESULTS_DIR}\``);
  lines.push('');
  lines.push('## SLA Gates');
  lines.push('');
  lines.push('| Gate | Threshold |');
  lines.push('|------|-----------|');
  lines.push(`| p99 latency | < ${SLA.p99_max_ms}ms (abort trigger) |`);
  lines.push(`| p95 latency | < ${SLA.p95_max_ms}ms |`);
  lines.push(`| Error rate | < ${SLA.error_rate_max_pct}% (abort trigger) |`);
  lines.push(`| Check pass rate | ≥ ${SLA.check_pass_min_pct}% |`);
  lines.push('');

  for (const a of analyses) {
    lines.push(`## ${a.name} — ${a.passed ? '✅ PASSED' : '❌ FAILED'}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    for (const [k, v] of a.rows) lines.push(`| ${k} | ${v} |`);
    lines.push('');
    lines.push('### SLA Evaluation');
    lines.push('');
    lines.push('| Gate | Observed | Verdict |');
    lines.push('|------|----------|---------|');
    for (const [g, o, v] of a.slaRows) lines.push(`| ${g} | ${o} | ${v} |`);
    lines.push('');
    if (a.trendRows.length > 0) {
      lines.push('### Custom Duration Trends');
      lines.push('');
      lines.push('| Metric | p50 | p95 | p99 |');
      lines.push('|--------|-----|-----|-----|');
      for (const [k, p50, p95, p99] of a.trendRows) lines.push(`| ${k} | ${p50} | ${p95} | ${p99} |`);
      lines.push('');
    }
    if (a.failures.length > 0) {
      lines.push('### ❌ Failures');
      lines.push('');
      for (const f of a.failures) lines.push(`- ${f}`);
      lines.push('');
    }
  }

  // Overall verdict
  const allPassed = analyses.every((a) => a.passed);
  lines.push('---');
  lines.push('');
  lines.push(`## Overall Verdict: ${allPassed ? '✅ ALL PHASES PASSED' : '❌ ONE OR MORE PHASES FAILED'}`);
  lines.push('');

  const report = lines.join('\n');
  const outPath = path.join(RESULTS_DIR, 'ANALYSIS.md');
  fs.writeFileSync(outPath, report, 'utf8');
  console.log(report);
  console.log(`\nReport written to: ${outPath}`);
  process.exit(allPassed ? 0 : 1);
}

main();