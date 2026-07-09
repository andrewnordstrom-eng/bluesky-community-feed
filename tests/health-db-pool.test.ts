/**
 * PROJ-917: proves the health check's `SELECT 1` runs against the
 * dedicated healthDb pool (src/db/client.ts), not the shared main `db`
 * pool. Prod incident 2026-07-06: the check previously shared the main
 * 50-conn pool; main-pool exhaustion starved it, readiness failed, and
 * systemd's watchdog SIGABRT-killed the service. Splitting the pool means
 * main-pool exhaustion can no longer take down the one check whose job is
 * to detect exactly that condition.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, healthDbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  healthDbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
  healthDb: {
    query: healthDbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    ping: vi.fn().mockResolvedValue('PONG'),
    zcard: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getHealthStatus } from '../src/lib/health.js';

describe('health check dedicated pool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Main pool: only ever hit by checkFeedFreshness's scoring-age lookup
    // in this suite — keep it healthy/empty so it can't influence the
    // database component's status.
    dbQueryMock.mockResolvedValue({ rows: [] });
  });

  it('queries healthDb (not the main db pool) for the database component', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const status = await getHealthStatus();

    expect(status.components.database.status).toBe('healthy');
    expect(healthDbQueryMock).toHaveBeenCalledWith('SELECT 1');
    // The main pool must never see the health probe's own query.
    expect(dbQueryMock).not.toHaveBeenCalledWith('SELECT 1');
  });

  it('reports the database component unhealthy when only healthDb fails, even if the main pool is fine', async () => {
    healthDbQueryMock.mockRejectedValue(new Error('connection timeout exceeded'));
    dbQueryMock.mockResolvedValue({ rows: [] });

    const status = await getHealthStatus();

    expect(status.components.database.status).toBe('unhealthy');
    expect(status.components.database.error).toBe('connection timeout exceeded');
  });

  it('reports the database component healthy when healthDb succeeds, even if a hypothetical main-pool query would have failed', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    dbQueryMock.mockRejectedValue(new Error('main pool exhausted'));

    const status = await getHealthStatus();

    // Proves database health is decided entirely by healthDb: main-pool
    // exhaustion (simulated here by a rejecting dbQueryMock) does not
    // propagate into the database component at all, since checkFeedFreshness's
    // internal db.query failure is caught and does not affect this component.
    expect(status.components.database.status).toBe('healthy');
  });

  // Thread 22: checkDatabase() races healthDb.query('SELECT 1') against a
  // 2000ms timeout (src/lib/health.ts HEALTH_CHECK_TIMEOUT) specifically so a
  // hung/exhausted pool can't wedge readiness forever -- that race is the
  // whole point of splitting this pool out (see this file's header comment),
  // so a hang that never resolves or rejects must still trip the timeout.
  it('reports the database component unhealthy when healthDb hangs past the 2000ms timeout', async () => {
    vi.useFakeTimers();
    try {
      // Never resolves or rejects -- simulates a hung/exhausted pool.
      healthDbQueryMock.mockImplementation(() => new Promise(() => {}));

      const statusPromise = getHealthStatus();
      await vi.advanceTimersByTimeAsync(2000);
      const status = await statusPromise;

      expect(status.components.database.status).toBe('unhealthy');
      expect(status.components.database.error).toBe('Database health check timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});
