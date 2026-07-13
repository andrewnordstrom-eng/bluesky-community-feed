import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { dbQueryMock, redisPingMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisPingMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    ping: redisPingMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { runStartupChecks } from '../src/lib/startup-checks.js';

describe('startup migration checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisPingMock.mockResolvedValue('PONG');
  });

  it('fails startup checks when latest migration is below 034', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] }) // checkPostgres
      .mockResolvedValueOnce({ rows: [{ max_migration: 1 }] }); // checkMigrationVersion

    await expect(runStartupChecks()).rejects.toThrow(
      /Migration startup check failed: database migrations are behind \(max=1, required=34\)/
    );
  });

  it('fails startup checks when latest migration is one below 034', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rows: [{ max_migration: 33 }] });

    await expect(runStartupChecks()).rejects.toThrow(
      /Migration startup check failed: database migrations are behind \(max=33, required=34\)/
    );
  });

  it('passes startup checks when latest migration is 034', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] }) // checkPostgres
      .mockResolvedValueOnce({ rows: [{ max_migration: 34 }] }); // checkMigrationVersion

    await expect(runStartupChecks()).resolves.toBeUndefined();
    expect(redisPingMock).toHaveBeenCalledTimes(1);
  });

  it('migration 034 reconciles only active zero-ballot results and audits the repair', () => {
    const migration = readFileSync(
      new URL('../src/db/migrations/034_governance_proposed_topic_weights.sql', import.meta.url),
      'utf8'
    );

    expect(migration).toContain("epoch.status = 'active'");
    expect(migration).toContain("epoch.phase = 'results'");
    expect(migration).toContain('NOT EXISTS');
    expect(migration).toContain('FROM governance_votes vote');
    expect(migration).toContain("SET phase = 'running'");
    expect(migration).toContain("'migration_reconcile_zero_ballot_results'");
  });
});
