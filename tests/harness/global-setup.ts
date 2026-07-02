/**
 * Vitest globalSetup for the A1 simulation-harness integration suite.
 *
 * Starts real `postgres:16` + `redis` Testcontainers, runs the REAL
 * migration runner (`scripts/migrate.ts`'s `runMigrations`) against the
 * container so the suite exercises the same DDL path as production (never
 * a schema-recreate hack, never pg-mem), then hands the connection URLs to
 * every test file via `project.provide` / `inject`.
 *
 * Only wired up for `tests/harness/**` via `vitest.harness.config.ts` — the
 * repo's default `npm test` (`vitest tests`, no config) never loads this
 * file, so the existing fast/fully-mocked unit suite is unaffected.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../scripts/migrate.js';

// Ambient `ProvidedContext` augmentation lives in ./vitest-provided-context.d.ts
// (a type-only declaration file — nothing to import at runtime).

/** Stop whichever of the two containers actually started, tolerating either
 *  (or both) already being stopped/never-started/failed-to-stop — used both
 *  on the setup-failure path and in the normal teardown below, so a leaked
 *  container is never left behind just because its sibling errored. */
async function stopAll(
  pg: StartedPostgreSqlContainer | undefined,
  redis: StartedRedisContainer | undefined
): Promise<void> {
  const results = await Promise.allSettled([pg?.stop(), redis?.stop()]);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (rejected) {
    throw rejected.reason;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;

  try {
    // Started via allSettled (not Promise.all) so that if one container
    // fails to start, we still know whether the OTHER one came up — and can
    // stop it in the catch block below instead of leaking it. Testcontainers'
    // Ryuk reaper is a backstop, not something routine setup failures during
    // CI/local iteration should have to rely on.
    const [pgResult, redisResult] = await Promise.allSettled([
      new PostgreSqlContainer('postgres:16')
        .withDatabase('corgi_sim_test')
        .withUsername('corgi_sim')
        .withPassword('corgi_sim')
        .start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);

    if (pgResult.status === 'fulfilled') {
      pg = pgResult.value;
    }
    if (redisResult.status === 'fulfilled') {
      redis = redisResult.value;
    }
    if (pgResult.status === 'rejected') {
      throw pgResult.reason;
    }
    if (redisResult.status === 'rejected') {
      throw redisResult.reason;
    }

    const databaseUrl = pg.getConnectionUri();
    const redisUrl = redis.getConnectionUrl();

    // Real migrations, real engine — not a schema-recreate hack.
    await runMigrations(databaseUrl);

    project.provide('corgiSimPgUrl', databaseUrl);
    project.provide('corgiSimRedisUrl', redisUrl);
  } catch (error) {
    // Best-effort cleanup — never let a container-stop failure replace the real
    // setup/migration error that CI needs to diagnose. The original error always
    // propagates; any stop failure is swallowed here (Ryuk remains the backstop).
    await stopAll(pg, redis).catch(() => {});
    throw error;
  }

  return async function teardown(): Promise<void> {
    // Promise.allSettled (not Promise.all): if `pg.stop()` rejects,
    // `redis.stop()` must still be attempted — otherwise one failing
    // teardown leaks the other container between test runs.
    await stopAll(pg, redis);
  };
}
