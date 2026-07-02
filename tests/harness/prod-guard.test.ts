/**
 * Prod-Guard Unit Tests
 *
 * Pure — no Postgres/Redis/Testcontainers dependency at all. Verifies the
 * simulation harness refuses to run against anything that looks like
 * production, and that the refusal of the *known* production signature
 * (docker-compose.prod.yml: Postgres port 5433 / db "bluesky_feed" / user
 * "feed"; Redis port 6380) cannot be bypassed by any flag.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertEphemeralPostgresUrl,
  assertEphemeralRedisUrl,
  assertEphemeralTarget,
  ProdGuardError,
} from '../../src/harness/prod-guard.js';

const PROD_POSTGRES_URL = 'postgresql://feed:supersecret@127.0.0.1:5433/bluesky_feed';
const PROD_REDIS_URL = 'redis://127.0.0.1:6380';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMPOSE_PROD_PATH = path.join(REPO_ROOT, 'docker-compose.prod.yml');

describe('assertEphemeralPostgresUrl', () => {
  afterEach(() => {
    delete process.env.CORGI_SIM_ALLOW;
  });

  it('aborts on the known production Postgres signature (port + db name)', () => {
    expect(() => assertEphemeralPostgresUrl(PROD_POSTGRES_URL)).toThrow(ProdGuardError);
  });

  it('aborts on the known production signature even when CORGI_SIM_ALLOW=1', () => {
    process.env.CORGI_SIM_ALLOW = '1';
    expect(() => assertEphemeralPostgresUrl(PROD_POSTGRES_URL)).toThrow(ProdGuardError);
  });

  it('aborts on the known production signature even with an explicit allowFlag: true', () => {
    expect(() => assertEphemeralPostgresUrl(PROD_POSTGRES_URL, { allowFlag: true })).toThrow(
      ProdGuardError
    );
  });

  it('aborts when db name matches production even on a different loopback port', () => {
    expect(() =>
      assertEphemeralPostgresUrl('postgresql://feed:pw@127.0.0.1:5432/bluesky_feed')
    ).toThrow(ProdGuardError);
  });

  it('allows a Testcontainers-style loopback URL with a random port and test db name', () => {
    expect(() =>
      assertEphemeralPostgresUrl('postgresql://corgi_sim:corgi_sim@127.0.0.1:55432/corgi_sim_test')
    ).not.toThrow();
  });

  it('allows "localhost" as a loopback hostname', () => {
    expect(() =>
      assertEphemeralPostgresUrl('postgresql://postgres:postgres@localhost:5432/community_feed')
    ).not.toThrow();
  });

  it('aborts on a non-local host with no allow flag set', () => {
    expect(() =>
      assertEphemeralPostgresUrl('postgresql://user:pw@db.example.com:5432/some_db')
    ).toThrow(ProdGuardError);
  });

  it('allows a non-local, non-prod-signature host when CORGI_SIM_ALLOW=1', () => {
    process.env.CORGI_SIM_ALLOW = '1';
    expect(() =>
      assertEphemeralPostgresUrl('postgresql://user:pw@ci-docker-host.example.com:5432/some_db')
    ).not.toThrow();
  });

  it('allows a non-local, non-prod-signature host with an explicit allowFlag: true', () => {
    expect(() =>
      assertEphemeralPostgresUrl('postgresql://user:pw@ci-docker-host.example.com:5432/some_db', {
        allowFlag: true,
      })
    ).not.toThrow();
  });

  it('throws a descriptive ProdGuardError on unparseable URLs', () => {
    expect(() => assertEphemeralPostgresUrl('not-a-url')).toThrow(ProdGuardError);
  });
});

describe('assertEphemeralRedisUrl', () => {
  afterEach(() => {
    delete process.env.CORGI_SIM_ALLOW;
  });

  it('aborts on the known production Redis signature (port 6380)', () => {
    expect(() => assertEphemeralRedisUrl(PROD_REDIS_URL)).toThrow(ProdGuardError);
  });

  it('aborts on the known production Redis signature even with allowFlag: true', () => {
    expect(() => assertEphemeralRedisUrl(PROD_REDIS_URL, { allowFlag: true })).toThrow(
      ProdGuardError
    );
  });

  it('allows a Testcontainers-style loopback Redis URL on a random port', () => {
    expect(() => assertEphemeralRedisUrl('redis://127.0.0.1:54932')).not.toThrow();
  });

  it('allows "localhost" as a loopback hostname', () => {
    expect(() => assertEphemeralRedisUrl('redis://localhost:6379')).not.toThrow();
  });

  it('aborts on a non-local Redis host with no allow flag set', () => {
    expect(() => assertEphemeralRedisUrl('redis://cache.example.com:6379')).toThrow(ProdGuardError);
  });

  it('allows a non-local, non-prod-signature Redis host with allowFlag: true', () => {
    expect(() =>
      assertEphemeralRedisUrl('redis://ci-docker-host.example.com:6379', { allowFlag: true })
    ).not.toThrow();
  });

  it('throws a descriptive ProdGuardError on unparseable Redis URLs', () => {
    expect(() => assertEphemeralRedisUrl('not-a-url')).toThrow(ProdGuardError);
  });
});

describe('KNOWN_PROD_POSTGRES / KNOWN_PROD_REDIS: docker-compose.prod.yml parity', () => {
  /**
   * Drift guard for prod-guard.ts's hardcoded production signature (see its
   * header comment). Reads the actual compose file and re-derives the
   * Postgres/Redis URL docker-compose.prod.yml's own values would produce,
   * then asserts the guard still hard-refuses it. If someone edits the
   * compose file's user/db/ports without updating prod-guard.ts's constants,
   * this test fails instead of the guard silently getting weaker.
   */
  it('still refuses a Postgres URL built from docker-compose.prod.yml\'s own values', async () => {
    const compose = await readFile(COMPOSE_PROD_PATH, 'utf8');

    const user = /POSTGRES_USER:\s*(\S+)/.exec(compose)?.[1];
    const database = /POSTGRES_DB:\s*(\S+)/.exec(compose)?.[1];
    const port = /"127\.0\.0\.1:(\d+):5432"/.exec(compose)?.[1];

    expect(user, 'POSTGRES_USER not found in docker-compose.prod.yml').toBeTruthy();
    expect(database, 'POSTGRES_DB not found in docker-compose.prod.yml').toBeTruthy();
    expect(port, 'postgres host port not found in docker-compose.prod.yml').toBeTruthy();

    const composeUrl = `postgresql://${user}:whatever@127.0.0.1:${port}/${database}`;
    expect(() => assertEphemeralPostgresUrl(composeUrl)).toThrow(ProdGuardError);
  });

  it('still refuses a Redis URL built from docker-compose.prod.yml\'s own port', async () => {
    const compose = await readFile(COMPOSE_PROD_PATH, 'utf8');

    const port = /"127\.0\.0\.1:(\d+):6379"/.exec(compose)?.[1];
    expect(port, 'redis host port not found in docker-compose.prod.yml').toBeTruthy();

    const composeUrl = `redis://127.0.0.1:${port}`;
    expect(() => assertEphemeralRedisUrl(composeUrl)).toThrow(ProdGuardError);
  });
});

describe('assertEphemeralTarget', () => {
  it('checks both Postgres and Redis, throwing if either matches production', () => {
    const okPostgres = 'postgresql://corgi_sim:corgi_sim@127.0.0.1:55432/corgi_sim_test';
    expect(() => assertEphemeralTarget(okPostgres, PROD_REDIS_URL)).toThrow(ProdGuardError);
    expect(() => assertEphemeralTarget(PROD_POSTGRES_URL, 'redis://127.0.0.1:54932')).toThrow(
      ProdGuardError
    );
  });

  it('passes when both targets are clearly ephemeral/local', () => {
    expect(() =>
      assertEphemeralTarget(
        'postgresql://corgi_sim:corgi_sim@127.0.0.1:55432/corgi_sim_test',
        'redis://127.0.0.1:54932'
      )
    ).not.toThrow();
  });
});
