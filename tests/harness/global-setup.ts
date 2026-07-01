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

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [pg, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16')
      .withDatabase('corgi_sim_test')
      .withUsername('corgi_sim')
      .withPassword('corgi_sim')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  const databaseUrl = pg.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  // Real migrations, real engine — not a schema-recreate hack.
  await runMigrations(databaseUrl);

  project.provide('corgiSimPgUrl', databaseUrl);
  project.provide('corgiSimRedisUrl', redisUrl);

  return async function teardown(): Promise<void> {
    await Promise.all([pg.stop(), redis.stop()]);
  };
}
