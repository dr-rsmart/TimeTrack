#!/usr/bin/env node
/**
 * Release gate for repository-side remaining limitations.
 * Secret rotation and mobile store rollout are intentionally external gates;
 * this script verifies the source/migration/test prerequisites only.
 */
import { spawnSync } from 'node:child_process';

const commands = [
  ['node', ['server/migration_preflight.mjs', '--strict']],
  ['node', ['server/tenant_migration_preflight.mjs', '--strict']],
  ['node', ['server/partition_preflight.mjs']],
  ['npx', ['vitest', 'run', '--coverage']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, env: process.env });
  if (result.status !== 0) {
    console.error(`[predeploy-limitations] failed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[predeploy-limitations] Repository-side gates passed.');
console.log(
  '[predeploy-limitations] External gates still require owner action: secret rotation and mobile rollout.',
);
