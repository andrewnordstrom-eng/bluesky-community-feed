/**
 * PROJ-917: POST /api/admin/trigger-cleanup used to 404 (ops/health-watchdog
 * called a route that didn't exist, hidden by `|| true`). This proves the
 * route now exists, delegates to triggerManualCleanup(), writes an audit
 * log entry, and reports success:false (not an error) when a cleanup run
 * was already in progress.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, triggerManualCleanupMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  triggerManualCleanupMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/maintenance/cleanup.js', () => ({
  triggerManualCleanup: triggerManualCleanupMock,
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { registerCleanupRoutes } from '../src/admin/routes/cleanup.js';

describe('admin trigger-cleanup route', () => {
  beforeEach(() => {
    dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
    triggerManualCleanupMock.mockReset();
  });

  it('triggers cleanup, returns the result, and writes an audit log entry', async () => {
    const cleanupResult = {
      postsDeleted: 42,
      orphanedLikesDeleted: 3,
      orphanedRepostsDeleted: 1,
      orphanedEngagementDeleted: 0,
      staleLikesDeleted: 0,
      staleRepostsDeleted: 0,
      oldFollowsDeleted: 5,
      vacuumRan: true,
      durationMs: 1234,
    };
    triggerManualCleanupMock.mockResolvedValue(cleanupResult);

    const app = Fastify();
    registerCleanupRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/trigger-cleanup',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      result: cleanupResult,
    });
    expect(triggerManualCleanupMock).toHaveBeenCalledTimes(1);

    const auditCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO governance_audit_log')
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(['did:plc:admin', expect.any(String)]);
    expect(JSON.parse((auditCall![1] as string[])[1]).result).toEqual(cleanupResult);

    await app.close();
  });

  it('reports success:false with a null result when a cleanup run is already in progress', async () => {
    triggerManualCleanupMock.mockResolvedValue(null);

    const app = Fastify();
    registerCleanupRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/trigger-cleanup',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: false,
      result: null,
    });

    await app.close();
  });

  // Thread 7 / 17: the audit-log write happens after triggerManualCleanup()
  // already ran (and may have mutated a lot of state) — a failure there must
  // not discard the cleanup result via a 500, mirroring how
  // src/maintenance/cleanup.ts treats its own system_status write as
  // non-fatal.
  it('still returns 200 with the cleanup result when the audit-log INSERT rejects', async () => {
    const cleanupResult = {
      postsDeleted: 10,
      orphanedLikesDeleted: 0,
      orphanedRepostsDeleted: 0,
      orphanedEngagementDeleted: 0,
      staleLikesDeleted: 0,
      staleRepostsDeleted: 0,
      oldFollowsDeleted: 0,
      vacuumRan: false,
      durationMs: 5,
    };
    triggerManualCleanupMock.mockResolvedValue(cleanupResult);
    dbQueryMock.mockImplementation(async (sql: unknown) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO governance_audit_log')) {
        throw new Error('simulated audit-log write failure');
      }
      return { rows: [] };
    });

    const app = Fastify();
    registerCleanupRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/trigger-cleanup',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      result: cleanupResult,
    });

    await app.close();
  });

  // Thread 17's second ask: a triggerManualCleanup() rejection must surface
  // as a proper error response, not an unhandled rejection that crashes the
  // process. Fastify's default async-handler error handling already covers
  // this (no route change needed) — this pins that behavior down.
  it('surfaces a 500 error response, not an unhandled rejection, when triggerManualCleanup rejects', async () => {
    triggerManualCleanupMock.mockRejectedValue(new Error('simulated cleanup failure'));

    const app = Fastify();
    registerCleanupRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/trigger-cleanup',
    });

    expect(response.statusCode).toBe(500);

    const auditCall = dbQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO governance_audit_log')
    );
    expect(auditCall).toBeUndefined();

    await app.close();
  });
});
