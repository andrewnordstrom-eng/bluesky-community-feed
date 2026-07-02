/**
 * Simulation Prod-Guard
 *
 * A1 (headless simulation core) is designed to run destructive, high-volume
 * synthetic governance/scoring cycles (seed votes, force epoch transitions,
 * rescore everything) against Postgres/Redis. Running that against the real
 * production database/cache would be catastrophic. This module is the single
 * chokepoint every entrypoint (`runScenario`, `Simulation`) must call before
 * touching either connection.
 *
 * Deliberately has NO dependency on `src/config.ts` (which eagerly parses
 * `process.env` and throws on missing required vars): this file must be
 * importable and unit-testable in total isolation, with arbitrary URL
 * strings, from a bare `vitest run` with no env setup at all.
 *
 * Policy:
 * 1. The known production signature (from `docker-compose.prod.yml`: Postgres
 *    port 5433 / db `bluesky_feed` / user `feed`; Redis port 6380) is refused
 *    unconditionally. No flag can override this — it is a hard stop.
 * 2. Otherwise, a loopback host (`127.0.0.1` / `localhost` / `::1`) is always
 *    allowed — this is what Testcontainers and the local `docker-compose.yml`
 *    dev stack both bind to.
 * 3. A non-loopback host is refused unless `CORGI_SIM_ALLOW` (or an explicit
 *    `allowFlag: true`) is set, for the rare case of an intentionally
 *    ephemeral remote target (e.g. a CI-provisioned Docker host). Even then,
 *    rule 1 still applies.
 */

export class ProdGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProdGuardError';
  }
}

export interface GuardOptions {
  /** Explicit override for a non-loopback host. Never overrides the hard prod refusal. */
  allowFlag?: boolean;
}

// Mirrors docker-compose.prod.yml's `postgres` service exactly (`POSTGRES_USER`,
// `POSTGRES_DB`, and the host-side port of the `ports:` mapping). This is
// deliberately hardcoded rather than read from the compose file at runtime —
// see this file's header (no dependency on anything that does I/O or env
// parsing) — but that means these three values can silently drift from the
// compose file if it's ever edited without a matching update here. This
// exact pairing is asserted in tests/harness/prod-guard.test.ts (a test
// reads docker-compose.prod.yml and confirms these constants still match),
// so a drift shows up as a CI failure instead of a silently weakened guard.
const KNOWN_PROD_POSTGRES = {
  port: 5433,
  database: 'bluesky_feed',
  user: 'feed',
} as const;

// Mirrors docker-compose.prod.yml's `redis` service host-side port. Same
// drift risk/test coverage as KNOWN_PROD_POSTGRES above.
const KNOWN_PROD_REDIS = {
  port: 6380,
} as const;

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  // Note: `new URL(...).hostname` always keeps the brackets for IPv6
  // literals (e.g. `[::1]`), never the bare `::1` form, so only the
  // bracketed form is checked here.
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]';
}

function parseUrlOrThrow(url: string, kind: 'Postgres' | 'Redis'): URL {
  try {
    return new URL(url);
  } catch {
    throw new ProdGuardError(`Refusing to run simulation: could not parse ${kind} URL "${url}".`);
  }
}

function resolveAllowFlag(options?: GuardOptions): boolean {
  if (options?.allowFlag !== undefined) {
    return options.allowFlag;
  }
  const raw = process.env.CORGI_SIM_ALLOW;
  return raw === '1' || raw?.toLowerCase() === 'true';
}

/**
 * Abort unless `databaseUrl` clearly targets an ephemeral/local Postgres
 * instance. Throws `ProdGuardError` otherwise.
 */
export function assertEphemeralPostgresUrl(databaseUrl: string, options?: GuardOptions): void {
  const parsed = parseUrlOrThrow(databaseUrl, 'Postgres');
  const port = parsed.port ? Number(parsed.port) : 5432;
  const database = parsed.pathname.replace(/^\//, '');
  const user = decodeURIComponent(parsed.username ?? '');

  const matchesProdPort = port === KNOWN_PROD_POSTGRES.port;
  const matchesProdDatabase = database === KNOWN_PROD_POSTGRES.database;
  const matchesProdUser = user === KNOWN_PROD_POSTGRES.user;

  // Hard refusal: known production signature. Never overridable by any flag.
  if ((matchesProdPort && matchesProdDatabase) || (matchesProdUser && matchesProdDatabase)) {
    throw new ProdGuardError(
      `Refusing to run simulation: Postgres target matches the known production ` +
        `signature (port ${KNOWN_PROD_POSTGRES.port}, db "${KNOWN_PROD_POSTGRES.database}", ` +
        `user "${KNOWN_PROD_POSTGRES.user}"). This guard cannot be bypassed for the ` +
        `production database under any circumstances.`
    );
  }

  if (isLoopbackHost(parsed.hostname)) {
    return;
  }

  if (!resolveAllowFlag(options)) {
    throw new ProdGuardError(
      `Refusing to run simulation against non-local Postgres host "${parsed.hostname}". ` +
        `Set CORGI_SIM_ALLOW=1 (or pass { allowFlag: true }) only for an explicitly ` +
        `ephemeral, non-production remote target.`
    );
  }
}

/**
 * Abort unless `redisUrl` clearly targets an ephemeral/local Redis instance.
 * Throws `ProdGuardError` otherwise.
 */
export function assertEphemeralRedisUrl(redisUrl: string, options?: GuardOptions): void {
  const parsed = parseUrlOrThrow(redisUrl, 'Redis');
  const port = parsed.port ? Number(parsed.port) : 6379;

  // Hard refusal: known production signature. Never overridable by any flag.
  if (port === KNOWN_PROD_REDIS.port) {
    throw new ProdGuardError(
      `Refusing to run simulation: Redis target matches the known production ` +
        `signature (port ${KNOWN_PROD_REDIS.port}). This guard cannot be bypassed for ` +
        `the production cache under any circumstances.`
    );
  }

  if (isLoopbackHost(parsed.hostname)) {
    return;
  }

  if (!resolveAllowFlag(options)) {
    throw new ProdGuardError(
      `Refusing to run simulation against non-local Redis host "${parsed.hostname}". ` +
        `Set CORGI_SIM_ALLOW=1 (or pass { allowFlag: true }) only for an explicitly ` +
        `ephemeral, non-production remote target.`
    );
  }
}

/** Convenience wrapper asserting both targets at once. */
export function assertEphemeralTarget(
  databaseUrl: string,
  redisUrl: string,
  options?: GuardOptions
): void {
  assertEphemeralPostgresUrl(databaseUrl, options);
  assertEphemeralRedisUrl(redisUrl, options);
}
