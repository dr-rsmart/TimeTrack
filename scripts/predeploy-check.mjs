/**
 * TimeTrack Pre-Deployment Verification
 * -------------------------------------
 * Runs all critical environment, cryptographic, database sanity checks and
 * the OpenAPI contract-drift guard prior to a production deployment.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

console.log('🚀 Running TimeTrack Pre-Deployment Verification Pipeline...\n');

// 1. Environment and Config Check
console.log('--- [1/4] Environment & Security Constraints Check ---');
const envResult = spawnSync('node', ['server/env_check.mjs'], { stdio: 'inherit' });
if (envResult.status !== 0) {
  console.error('\n❌ Environment check failed. Aborting deployment.');
  process.exit(1);
}

// 2. Database Schema & Migration Verification
console.log('\n--- [2/4] Database Health & Tenant Integrity Check ---');
const dbResult = spawnSync('node', ['server/db_check.mjs'], { stdio: 'inherit' });
if (dbResult.status !== 0) {
  console.error('\n❌ Database check failed. Aborting deployment.');
  process.exit(1);
}

const migrationResult = spawnSync('node', ['server/migration_preflight.mjs', '--strict'], {
  stdio: 'inherit',
});
if (migrationResult.status !== 0) {
  console.error('\n❌ Migration preflight failed. Set MIGRATE_DATABASE_URL to an elevated role.');
  process.exit(1);
}

// 3. Test Suite Pass
console.log('\n--- [3/4] Running Automated Test Suite ---');
const testResult = spawnSync('npx', ['vitest', 'run'], { stdio: 'inherit', shell: true });
if (testResult.status !== 0) {
  console.error('\n❌ Test suite failed. Aborting deployment.');
  process.exit(1);
}

// 4. OpenAPI Contract Drift Guard (fail-closed)
// The committed spec (server/docs/openapi.json) must match a fresh generation
// from the Zod-derived registry. A stale spec means routes changed without the
// contract being regenerated — the exact drift class this repo's contract-first
// design exists to prevent. On drift the regenerated file is LEFT IN PLACE so
// the operator can review and commit it; the deploy still aborts.
console.log('\n--- [4/4] OpenAPI Contract Drift Guard ---');
const specPath = path.join('server', 'docs', 'openapi.json');
let committedSpec;
try {
  committedSpec = readFileSync(specPath, 'utf8');
} catch {
  console.error(`\n❌ Committed OpenAPI spec not found at ${specPath}. Aborting deployment.`);
  process.exit(1);
}
const openapiResult = spawnSync('npm', ['run', 'openapi:generate'], {
  stdio: 'inherit',
  shell: true,
  cwd: 'server',
});
if (openapiResult.status !== 0) {
  console.error('\n❌ OpenAPI generation failed. Aborting deployment.');
  process.exit(1);
}
const regeneratedSpec = readFileSync(specPath, 'utf8');
if (committedSpec !== regeneratedSpec) {
  console.error(
    '\n❌ OpenAPI DRIFT DETECTED: server/docs/openapi.json did not match a fresh ' +
      'generation from server/src/openapi.ts. The spec has been regenerated in place — ' +
      'review the diff, commit it, and re-run this check.',
  );
  process.exit(1);
}
console.log('✅ OpenAPI spec matches the Zod-derived registry (no drift).');

console.log(
  '\n✨ ALL PRE-DEPLOYMENT CHECKS PASSED. System is 100% ready for production deployment!',
);
process.exit(0);
