import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'server/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['server/src/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'server/src/seed.ts',
        'server/src/seed-stress.ts',
      ],
      // Baseline thresholds (measured 2026-09-14: stmts 12.75%, branches
      // 9.86%, funcs 10.36%, lines 12.59%). Deliberately below the measured
      // baseline as a safety margin; the Phase 3 pass ratchets them upward
      // as component/integration tests land.
      thresholds: {
        statements: 10,
        branches: 8,
        functions: 8,
        lines: 10,
      },
    },
  },
});
