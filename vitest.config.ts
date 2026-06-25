import { defineConfig } from 'vitest/config'

// Coverage ratchet for the backend (src/**). Floors are integer values just
// below the measured baseline, giving a small buffer against flaky line hits.
// Raise a floor deliberately when you add coverage — do not lower it. The
// correctness-critical scoring/ingestion modules carry higher floors than the
// global gate. autoUpdate is intentionally off so the tracked config is stable
// and only changes in a reviewed commit (vitest 4.x autoUpdate rewrites exact
// decimals on every run, which churns the tracked file and removes the buffer).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/types/**',
        '**/index.ts',
        'tests/**',
        'scripts/**',
        'web/**',
        '**/*.test.ts',
      ],
      thresholds: {
        autoUpdate: false,
        lines: 50,
        statements: 50,
        functions: 50,
        branches: 40,
        perFile: false,
        'src/scoring/**': {
          lines: 73,
          statements: 72,
          functions: 78,
          branches: 68,
        },
        'src/ingestion/handlers/**': {
          lines: 66,
          statements: 67,
          functions: 77,
          branches: 75,
        },
      },
    },
  },
})
