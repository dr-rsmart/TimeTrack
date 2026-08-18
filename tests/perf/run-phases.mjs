#!/usr/bin/env node
/**
 * TimeTrack — Sequential Stress Phase Runner with System Abort Guards
 * ====================================================================
 * Runs k6 stress phases SEQUENTIALLY (never concurrently) and monitors
 * host resources. Aborts the current phase immediately when any
 * system-safety threshold is breached:
 *
 *   ABORT TRIGGERS (task requirement c):
 *   ─────────────────────────────────────
 *   • Memory (RAM) usage        > 90%
 *   • Swap/Page file usage      > 90%
 *   • Disk I/O queue length     > 2  (or 100% active time)
 *   • CPU utilization           > 95% (sustained, high wait)
 *   • Error rate                > 5%   (enforced by k6 thresholds)
 *   • p99 latency degradation   > 3s   (enforced by k6 thresholds)
 *
 * Phases (sequential isolation):
 *   Phase A — Baseline: 1,000 VUs (1 worker)
 *   Phase B — Stress:   3,000 VUs (1 worker)
 *   Phase C — Peak:     5,000 VUs (2 workers → use k6 operator / 2 k6 processes)
 *
 * Usage:
 *   node tests/perf/run-phases.mjs                 # all phases
 *   node tests/perf/run-phases.mjs --phase A       # single phase
 *   node tests/perf/run-phases.mjs --smoke         # 5% VU scale smoke run
 *   node tests/perf/run-phases.mjs --skip-monitor  # no resource watchdog
 */

import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ── CLI args ──
const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const ONLY_PHASE = argVal('--phase')?.toUpperCase() || null;
const SMOKE = hasFlag('--smoke');
const SKIP_MONITOR = hasFlag('--skip-monitor');
const API_URL = argVal('--api-url') || process.env.API_URL || 'http://localhost:4000';

// ── Abort thresholds ──
const LIMITS = {
  RAM_PCT: 90,        // Memory (RAM) > 90%
  SWAP_PCT: 90,       // Swap/Page file > 90%
  CPU_PCT: 95,        // CPU utilization > 95%
  DISK_QUEUE: 2,      // Disk queue length > 2
};

// ── Phase definitions (SEQUENTIAL) ──
const PHASES = [
  {
    id: 'A',
    name: 'Phase A — Baseline (1,000 VUs / 1 worker)',
    script: 'timetrack-load.js',
    vus: 1000,
    workers: 1,
    env: {},
  },
  {
    id: 'B',
    name: 'Phase B — Stress (3,000 VUs / 1 worker)',
    script: 'timetrack-stress-suite.js',
    vus: 3000,
    workers: 1,
    env: {},
  },
  {
    id: 'C',
    name: 'Phase C — Peak (5,000 VUs / 2 workers)',
    script: 'timetrack-stress-5000vu.js',
    vus: 5000,
    workers: 2,
    env: {},
  },
];

// ── System resource sampling ──
function sampleMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = ((total - free) / total) * 100;

  // Swap estimation: on Windows, use wmic pagefile; fallback to 0 (unavailable)
  let swapPct = 0;
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'wmic pagefile list /format:csv 2>nul',
        { encoding: 'utf8', timeout: 3000, windowsHide: true }
      );
      // Parse AllocBaseSize/CurrentUsage if present; best-effort
      const lines = out.split('\n').filter((l) => l.trim());
      if (lines.length > 1) {
        const nums = lines[lines.length - 1].split(',').filter(Boolean).map(Number);
        if (nums.length >= 3 && nums[1] > 0) {
          swapPct = Math.min(100, (nums[2] / nums[1]) * 100);
        }
      }
    }
  } catch {
    swapPct = 0; // best-effort; not fatal
  }

  return { usedPct, swapPct, totalGB: (total / 1e9).toFixed(1), freeGB: (free / 1e9).toFixed(1) };
}

let lastCpu = os.cpus().map((c) => c.times);
function sampleCpu() {
  const cpus = os.cpus().map((c) => c.times);
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < cpus.length; i++) {
    const prev = lastCpu[i] || cpus[i];
    const idle = cpus[i].idle - prev.idle;
    const total =
      cpus[i].user - prev.user +
      cpus[i].nice - prev.nice +
      cpus[i].sys - prev.sys +
      cpus[i].irq - prev.irq +
      cpus[i].idle - prev.idle;
    idleDelta += idle;
    totalDelta += total;
  }
  lastCpu = cpus;
  const pct = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
  return { pct, cores: cpus.length, loadAvg: os.loadavg() };
}

function sampleDiskQueue() {
  // Best-effort disk queue sampling.
  // Windows: typeperf counter; Linux: /proc/diskstats derivation.
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'typeperf "\\PhysicalDisk(_Total)\\Current Disk Queue Length" -sc 1 -nh 2>nul',
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      );
      const match = out.match(/"([0-9.]+)"\s*$/m);
      if (match) return parseFloat(match[1]);
    } else {
      // Linux: approximate from /proc/diskstats (io in-flight field 9)
      const stats = fs.readFileSync('/proc/diskstats', 'utf8');
      let inflight = 0;
      for (const line of stats.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 12 && /^(sd|nvme|vd)/.test(parts[2]) && !/p\d+$|\d+n\d+p\d+$/.test(parts[2])) {
          inflight += parseInt(parts[8] || '0', 10);
        }
      }
      return inflight;
    }
  } catch {
    return 0;
  }
  return 0;
}

// ── Watchdog: evaluates abort conditions, kills k6 on breach ──
function createWatchdog(k6Proc, phaseName, onAbort) {
  let cpuHotStreak = 0;
  const interval = setInterval(() => {
    const mem = sampleMemory();
    const cpu = sampleCpu();
    const diskQ = sampleDiskQueue();

    const breaches = [];
    if (mem.usedPct > LIMITS.RAM_PCT) breaches.push(`RAM ${mem.usedPct.toFixed(1)}% > ${LIMITS.RAM_PCT}%`);
    if (mem.swapPct > LIMITS.SWAP_PCT) breaches.push(`Swap ${mem.swapPct.toFixed(1)}% > ${LIMITS.SWAP_PCT}%`);
    if (diskQ > LIMITS.DISK_QUEUE) breaches.push(`Disk queue ${diskQ} > ${LIMITS.DISK_QUEUE}`);

    // CPU: require 3 consecutive hot samples (~6s sustained) to avoid spikes
    if (cpu.pct > LIMITS.CPU_PCT) cpuHotStreak++;
    else cpuHotStreak = 0;
    if (cpuHotStreak >= 3) breaches.push(`CPU ${cpu.pct.toFixed(1)}% > ${LIMITS.CPU_PCT}% (sustained)`);

    console.log(
      `  [watchdog] RAM ${mem.usedPct.toFixed(0)}% | Swap ${mem.swapPct.toFixed(0)}% | ` +
      `CPU ${cpu.pct.toFixed(0)}% | DiskQ ${diskQ.toFixed(1)} | load ${cpu.loadAvg[0].toFixed(2)}`
    );

    if (breaches.length > 0) {
      console.error(`\n  🛑 ABORT TRIGGERED (${phaseName}): ${breaches.join('; ')}`);
      clearInterval(interval);
      try { k6Proc.kill('SIGTERM'); } catch {}
      onAbort(breaches);
    }
  }, 2000);

  return { stop: () => clearInterval(interval) };
}

// ── Run a single k6 phase ──
function runPhase(phase) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, phase.script);
    const vuScale = SMOKE ? 0.05 : 1;

    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`  ▶ ${phase.name}${SMOKE ? ' [SMOKE 5%]' : ''}`);
    console.log(`    script:  ${phase.script}`);
    console.log(`    workers: ${phase.workers}`);
    console.log(`    target:  ${API_URL}`);
    console.log('══════════════════════════════════════════════════════════\n');

    // Phase C with 2 workers: launch 2 k6 processes each at 50% VU load.
    // (On Kubernetes, replace with k6-operator TestRun sharding — see
    //  tests/perf/k8s/k6-testrun.yaml)
    const procs = [];
    const results = [];
    let aborted = null;

    for (let w = 0; w < phase.workers; w++) {
      const k6Args = [
        'run',
        scriptPath,
        '-e', `API_URL=${API_URL}`,
        '-e', `VU_SCALE=${vuScale / phase.workers}`,
        '--summary-export', path.join(ROOT, `tests/perf/results/phase-${phase.id}-w${w + 1}-summary.json`),
      ];
      if (SMOKE) k6Args.push('--no-usage-report');

      const proc = spawn('k6', k6Args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env, ...phase.env },
      });

      proc.on('exit', (code) => {
        results.push({ worker: w + 1, code });
        if (results.length === phase.workers) {
          const worst = Math.max(...results.map((r) => r.code ?? 1));
          resolve({ phase: phase.id, exitCode: aborted ? 130 : worst, aborted });
        }
      });

      procs.push(proc);
    }

    // Watchdog monitors the first worker process (host-level metrics are global)
    if (!SKIP_MONITOR) {
      const watchdog = createWatchdog(procs[0], phase.name, (breaches) => {
        aborted = breaches;
        // Kill all workers
        procs.forEach((p) => { try { p.kill('SIGTERM'); } catch {} });
      });
      procs[0].on('exit', () => watchdog.stop());
    }
  });
}

// ── Main: sequential execution ──
async function main() {
  const resultsDir = path.join(ROOT, 'tests/perf/results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  TimeTrack — Sequential Stress Phase Runner              ║');
  console.log('║  Phases run SEQUENTIALLY with system abort guards        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  API target:   ${API_URL}`);
  console.log(`  Smoke mode:   ${SMOKE ? 'YES (5% VUs)' : 'no'}`);
  console.log(`  Watchdog:     ${SKIP_MONITOR ? 'DISABLED' : 'ENABLED'}`);
  console.log(`  Abort limits: RAM>${LIMITS.RAM_PCT}% Swap>${LIMITS.SWAP_PCT}% CPU>${LIMITS.CPU_PCT}% DiskQ>${LIMITS.DISK_QUEUE}`);

  const phases = ONLY_PHASE ? PHASES.filter((p) => p.id === ONLY_PHASE) : PHASES;
  if (phases.length === 0) {
    console.error(`Unknown phase: ${ONLY_PHASE}. Valid: A, B, C`);
    process.exit(2);
  }

  const summary = [];
  for (const phase of phases) {
    const result = await runPhase(phase);
    summary.push(result);

    if (result.aborted) {
      console.error(`\n⛔ ${phase.name} ABORTED by system watchdog: ${result.aborted.join('; ')}`);
      console.error('   Subsequent phases SKIPPED (sequential fail-fast).\n');
      break; // fail-fast: stop the pipeline
    }
    if (result.exitCode !== 0) {
      console.error(`\n⛔ ${phase.name} FAILED (k6 exit ${result.exitCode}).`);
      console.error('   Threshold breach or error — subsequent phases SKIPPED.\n');
      break; // fail-fast on k6 threshold abort too
    }
    console.log(`\n✅ ${phase.name} PASSED\n`);
    // Cooldown between phases: let the system recover
    if (phase !== phases[phases.length - 1]) {
      console.log('  ⏳ Cooldown 15s before next phase...');
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  // ── Final report ──
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  PHASE EXECUTION SUMMARY');
  console.log('══════════════════════════════════════════════════════════');
  for (const r of summary) {
    const status = r.aborted ? '🛑 ABORTED (system guard)' : r.exitCode === 0 ? '✅ PASSED' : `❌ FAILED (exit ${r.exitCode})`;
    console.log(`  Phase ${r.phase}: ${status}`);
  }
  const failed = summary.some((r) => r.exitCode !== 0);
  console.log('══════════════════════════════════════════════════════════\n');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(2);
});