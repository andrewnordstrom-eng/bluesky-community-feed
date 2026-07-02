/**
 * Vitest config for the A1 simulation-harness suite (tests/harness/**).
 *
 * Deliberately NOT named `vitest.config.ts`/`.mts`: this repo has no root
 * Vitest config today (`npm test` = `vitest tests` on pure defaults, fully
 * mocked, no real DB/Redis — see docs/agent build-bible §1/§4). Adding a
 * root `vitest.config.ts` with a Testcontainers `globalSetup` would be
 * auto-loaded by that plain `vitest tests` invocation too, silently adding
 * container startup + a real Postgres/Redis dependency to every existing
 * unit test run. Naming this file something Vitest doesn't auto-resolve
 * keeps the two tiers (fast, fully-mocked unit suite vs. this
 * Testcontainers-backed integration suite) genuinely separate, matching the
 * two-tier CI split the harness blueprint calls for.
 *
 * A second, complementary reason `include` below covers `*.sim.ts` in
 * addition to `*.test.ts`: files that need the real Testcontainers stack
 * (invariants, the integration cycle, the golden snapshot) are named
 * `*.sim.ts` — NOT `*.test.ts` — so they fall outside Vitest's default
 * include glob (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`) too. Without that,
 * merely having these files exist under `tests/harness/**` would make the
 * plain default `npm test` (`vitest tests`, no config) sweep them up and
 * fail (missing env vars / no container). This mirrors the exact convention
 * this repo already uses for `tests/stress/*.stress.ts` — see build bible
 * §1: "stress scenario files ... are structurally excluded from `npm test`
 * by naming, not by explicit exclude config." `prod-guard.test.ts` is the
 * one harness file that's pure/fast/needs-no-container, so it keeps the
 * `.test.ts` suffix and is safe to run under the plain default suite too.
 *
 * Invoked explicitly via `npm run sim:core` or
 * `vitest run --config vitest.harness.config.ts tests/harness`.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/harness/**/*.test.ts', 'tests/harness/**/*.sim.ts'],
    globalSetup: ['tests/harness/global-setup.ts'],
    setupFiles: ['tests/harness/setup-env.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // All integration tests share one Testcontainers-backed Postgres/Redis
    // instance for the whole run — keep test files from racing each other's
    // TRUNCATE/epoch-transition writes by never running two files at once.
    fileParallelism: false,
  },
});
