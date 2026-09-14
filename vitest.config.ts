import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['server/src/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'server/src/seed.ts',
        'server/src/seed-stress.ts',
      ],
      // Baseline thresholds (measured 2026-09-14: stmts 12.75%, branches
      // 9.86%, funcs 10.36%, lines 12.59%). Ratcheted in Phase 3 to
      // stmts 14.42 / branches 10.86 / funcs 12.27 / lines 14.36 after
      // the first jsdom component tests landed.
      thresholds: {
        statements: 13,
        branches: 10,
        functions: 11,
        lines: 13,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          globals: false,
          testTimeout: 30000,
          include: ['tests/**/*.test.ts', 'server/src/**/*.test.ts'],
          // Modules under test that import server/src/config.ts fail fast when
          // JWT_SECRET is absent. Test-only placeholder — production still
          // refuses insecure secrets via config.ts validation.
          env: {
            JWT_SECRET: 'vitest-only-secret-0000000000000000000000000000',
          },
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: false,
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/setup-web.ts'],
        },
      },
    ],
  },
});
