#!/usr/bin/env node
/**
 * Owner-Gate Verification (Phase 1 — release-gate hardening)
 * ----------------------------------------------------------
 * Mechanically verifies the owner-only remediation items tracked as
 * Open-01 / Open-02 / Open-12 in docs/AUDIT_REGISTER.md and detailed in
 * docs/SECURITY_REMEDIATION_RUNBOOK.md:
 *
 *   G1  Leaked production DSN purged from ALL git history (Open-01)
 *   G2  .gitleaks.toml allowlist for the leaked commits removed (Open-01)
 *   G3  Plaintext third-party secrets removed from the workspace (Open-02/12)
 *   G4  REDIS_URL configured for production topology (Open-04 hardening)
 *   G5  Railway + local Postgres password rotations (manual acks)
 *
 * Items requiring Railway / 1Password / GitHub force-push access can only be
 * VERIFIED here, not performed. Run:  npm run owner:gate [--json]
 *
 * Exit codes: 0 = all gates pass · 1 = at least one gate FAILS.
 * Manual acks: OWNER_GATE_ACK_ROTATED_RAILWAY_PW=1 and
 * OWNER_GATE_ACK_ROTATED_LOCAL_PW=1 once the owner completes those steps.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const jsonMode = process.argv.includes('--json');
const results = [];

function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

// ── G1: leaked DSN anywhere in git history ──────────────────────────────
function gateHistoryClean() {
  const id = 'G1';
  const name = 'Leaked production DSN purged from git history (Open-01)';
  try {
    const revs = git(['rev-list', '--all']).trim().split(/\r?\n/).filter(Boolean);
    // Batch-scan every revision for credential-bearing DB/Redis URIs.
    // Known non-secrets (CI ephemeral, demo data, placeholders) are excluded.
    const uriRe = /(?:postgres(?:ql)?|rediss?):\/\/[^\s:@/"']+:[^\s@/"']+@/gi;
    const allow = [
      'ci_pg_password',
      'Password123',
      'USER:PASSWORD',
      'OWNER:PASSWORD',
      'OWNER:...@',
      'postgres:postgres@',
    ];
    const hits = new Set();
    for (const rev of revs) {
      let out = '';
      try {
        out = git([
          'grep',
          '-I',
          '-E',
          '--no-color',
          '(postgres(ql)?|rediss?)://[^\\s:@/]+:[^\\s@]+@',
          rev,
          '--',
        ]);
      } catch {
        continue; // git grep exits 1 when there are no matches
      }
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(uriRe);
        if (!m) continue;
        for (const uri of m) {
          if (allow.some((a) => uri.includes(a))) continue;
          hits.add(uri.replace(/:[^:@/]+@/, ':***@') + `  (rev ${rev.slice(0, 8)})`);
        }
      }
    }
    if (hits.size === 0) {
      record(id, name, 'PASS', `${revs.length} revisions scanned; no credential-bearing URIs.`);
    } else {
      record(
        id,
        name,
        'FAIL',
        `Credential-bearing URI(s) still in history: ${[...hits].join(' | ')}. ` +
          'Rotate the password, then rewrite history per SECURITY_REMEDIATION_RUNBOOK.md step 2.',
      );
    }
  } catch (err) {
    record(id, name, 'ERROR', String(err.message ?? err));
  }
}

// ── G2: gitleaks allowlist for leaked commits removed ───────────────────
function gateGitleaksAllowlist() {
  const id = 'G2';
  const name = '.gitleaks.toml leaked-commit allowlist removed (Open-01)';
  try {
    const cfg = fs.readFileSync(path.join(ROOT, '.gitleaks.toml'), 'utf8');
    const hasCommitAllowlist = /commits\s*=\s*\[[^\]]*\]/s.test(cfg);
    const hasRicJer = cfg.includes('RicJer24');
    if (!hasCommitAllowlist && !hasRicJer) {
      record(id, name, 'PASS', 'No leaked-commit allowlist entries remain.');
    } else {
      record(
        id,
        name,
        'FAIL',
        `Allowlist still present (commits block: ${hasCommitAllowlist}, RicJer24: ${hasRicJer}). ` +
          'Remove after the history rewrite completes.',
      );
    }
  } catch (err) {
    record(id, name, 'ERROR', String(err.message ?? err));
  }
}

// ── G3: plaintext third-party secrets in the workspace ──────────────────
function gateWorkspaceSecrets() {
  const id = 'G3';
  const name = 'Third-party secrets moved to a secret manager (Open-02/12)';
  const offenders = [];
  for (const f of ['asc-api-key.json', 'asc-api-key.p8', 'google-service-account.json']) {
    if (fs.existsSync(path.join(ROOT, f))) offenders.push(f);
  }
  const rootEnv = path.join(ROOT, '.env');
  if (fs.existsSync(rootEnv)) {
    const env = fs.readFileSync(rootEnv, 'utf8');
    if (/NAMECHEAP_(API_KEY|PASSWORD)/.test(env)) offenders.push('.env (NAMECHEAP_* keys)');
    if (/iOS_Build_/.test(env)) offenders.push('.env (iOS_Build_* credentials)');
  }
  if (offenders.length === 0) {
    record(id, name, 'PASS', 'No plaintext third-party credentials in the workspace.');
  } else {
    record(
      id,
      name,
      'FAIL',
      `Still present: ${offenders.join(', ')}. Move to 1Password/Railway variables and delete ` +
        'local copies per SECURITY_REMEDIATION_RUNBOOK.md step 3.',
    );
  }
}

// ── G4: REDIS_URL for production topology ───────────────────────────────
function gateRedis() {
  const id = 'G4';
  const name = 'REDIS_URL configured for production (Open-04 hardening)';
  const url = process.env.REDIS_URL || (process.env.REDIS_HOST ? 'redis://host' : undefined);
  if (url) {
    record(id, name, 'PASS', 'REDIS_URL is set in this environment.');
  } else {
    record(
      id,
      name,
      'FAIL',
      'REDIS_URL not set in this environment. On Railway, add REDIS_URL to the production ' +
        'service variables (single-instance launches may proceed with the env_check warning).',
    );
  }
}

// ── G5: password rotations (manual acknowledgement) ─────────────────────
function gateRotations() {
  const id = 'G5';
  const name = 'Railway + local Postgres passwords rotated (runbook steps 1 & 4)';
  const railway = process.env.OWNER_GATE_ACK_ROTATED_RAILWAY_PW === '1';
  const local = process.env.OWNER_GATE_ACK_ROTATED_LOCAL_PW === '1';
  if (railway && local) {
    record(id, name, 'PASS', 'Both rotations acknowledged by the owner.');
  } else {
    record(
      id,
      name,
      'FAIL',
      `Manual acks missing (Railway PW: ${railway}, local PW: ${local}). After rotating, re-run ` +
        'with OWNER_GATE_ACK_ROTATED_RAILWAY_PW=1 OWNER_GATE_ACK_ROTATED_LOCAL_PW=1.',
    );
  }
}

gateHistoryClean();
gateGitleaksAllowlist();
gateWorkspaceSecrets();
gateRedis();
gateRotations();

const failed = results.filter((r) => r.status !== 'PASS');

if (jsonMode) {
  console.log(JSON.stringify({ pass: failed.length === 0, results }, null, 2));
} else {
  console.log('TimeTrack owner-gate verification (Phase 1)');
  console.log('='.repeat(60));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} [${r.id}] ${r.name}\n   ${r.detail}`);
  }
  console.log('='.repeat(60));
  console.log(
    failed.length === 0
      ? 'VERDICT: ALL OWNER GATES PASS ✅'
      : `VERDICT: ${failed.length} OWNER GATE(S) OPEN ❌ — see docs/SECURITY_REMEDIATION_RUNBOOK.md`,
  );
}

process.exit(failed.length === 0 ? 0 : 1);
