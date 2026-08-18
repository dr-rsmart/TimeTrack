/**
 * TimeTrack Pre-Deployment Verification
 * -------------------------------------
 * Runs all critical environment, cryptographic, and database sanity checks
 * prior to a production deployment.
 */

import { spawnSync } from 'child_process';
import path from 'path';

console.log('🚀 Running TimeTrack Pre-Deployment Verification Pipeline...\n');

// 1. Environment and Config Check
console.log('--- [1/3] Environment & Security Constraints Check ---');
const envResult = spawnSync('node', ['server/env_check.mjs'], { stdio: 'inherit' });
if (envResult.status !== 0) {
  console.error('\n❌ Environment check failed. Aborting deployment.');
  process.exit(1);
}

// 2. Database Schema & Migration Verification
console.log('\n--- [2/3] Database Health & Tenant Integrity Check ---');
const dbResult = spawnSync('node', ['server/db_check.mjs'], { stdio: 'inherit' });
if (dbResult.status !== 0) {
  console.error('\n❌ Database check failed. Aborting deployment.');
  process.exit(1);
}

// 3. Test Suite Pass
console.log('\n--- [3/3] Running Automated Test Suite ---');
const testResult = spawnSync('npx', ['vitest', 'run'], { stdio: 'inherit', shell: true });
if (testResult.status !== 0) {
  console.error('\n❌ Test suite failed. Aborting deployment.');
  process.exit(1);
}

console.log('\n✨ ALL PRE-DEPLOYMENT CHECKS PASSED. System is 100% ready for production deployment!');
process.exit(0);
