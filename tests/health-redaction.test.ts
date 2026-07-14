import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, healthDbQueryMock, redisPingMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn().mockResolvedValue({ rows: [] }),
  healthDbQueryMock: vi.fn(),
  redisPingMock: vi.fn(),
}));

// PROJ-917: checkDatabase() in src/lib/health.ts now queries the dedicated
// healthDb pool (src/db/client.ts), not the shared `db` pool — the "database
// down/up" scenarios below drive healthDbQueryMock. `dbQueryMock` remains
// wired to the main pool for the other query checkFeedFreshness makes
// (current_scoring_run), which this suite doesn't otherwise exercise.
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
    ping: redisPingMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import {
  calculateJetstreamHealth,
  getPublicHealthStatus,
  registerJetstreamHealth,
  registerScoringHealth,
} from '../src/lib/health.js';
import { registerAdminHealthRoutes } from '../src/admin/routes/health.js';

describe('health response redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    registerJetstreamHealth(() => ({
      status: 'healthy',
      connected: true,
    }));
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));
  });

  it('calculates event and cursor freshness at the five-minute boundary', () => {
    const nowMs = new Date('2026-07-13T23:30:00.000Z').getTime();
    const ingestionStartedAt = new Date(nowMs - 1000);
    const runtimeState = {
      activeEvents: 20,
      pendingEvents: 25,
      maxConcurrentEvents: 20,
      maxPendingEvents: 10_000,
      pauseQueueThreshold: 100,
      resumeQueueThreshold: 25,
      inboundPaused: false,
      pauseCount: 3,
      resumeCount: 3,
      overloadReconnectCount: 0,
      flowControlFailureReconnectCount: 0,
      totalDroppedEvents: 0,
      failedCursorPersistenceFloorUs: null,
      cursorUs: null,
      cursorLagMs: null,
    };

    expect(calculateJetstreamHealth(
      true,
      new Date(nowMs - 1000),
      runtimeState,
      nowMs,
      ingestionStartedAt
    )).toMatchObject({
      status: 'healthy',
      connected: true,
      last_event_age_ms: 1000,
    });

    expect(calculateJetstreamHealth(
      true,
      new Date(nowMs - 299_999),
      runtimeState,
      nowMs,
      ingestionStartedAt
    )).toMatchObject({
      status: 'healthy',
      last_event_age_ms: 299_999,
    });

    expect(calculateJetstreamHealth(
      true,
      new Date(nowMs - 300_000),
      runtimeState,
      nowMs,
      ingestionStartedAt
    )).toMatchObject({
      status: 'unhealthy',
      connected: true,
      last_event_age_ms: 300_000,
      error: 'No Jetstream events processed for 300s',
    });

    expect(calculateJetstreamHealth(
      true,
      new Date(nowMs - 1000),
      { ...runtimeState, cursorLagMs: 299_999 },
      nowMs,
      ingestionStartedAt
    )).toMatchObject({
      status: 'healthy',
      cursor_lag_ms: 299_999,
    });

    expect(calculateJetstreamHealth(
      true,
      new Date(nowMs - 1000),
      { ...runtimeState, cursorLagMs: 300_000 },
      nowMs,
      ingestionStartedAt
    )).toMatchObject({
      status: 'unhealthy',
      connected: true,
      cursor_lag_ms: 300_000,
      error: 'Jetstream cursor is 300s behind',
    });

    expect(calculateJetstreamHealth(
      true,
      null,
      runtimeState,
      nowMs,
      new Date(nowMs - 299_999)
    )).toMatchObject({
      status: 'healthy',
      connected: true,
    });

    expect(calculateJetstreamHealth(
      true,
      null,
      runtimeState,
      nowMs,
      new Date(nowMs - 300_000)
    )).toMatchObject({
      status: 'unhealthy',
      connected: true,
      error: 'No Jetstream events processed for 300s',
    });

    expect(calculateJetstreamHealth(
      false,
      null,
      runtimeState,
      nowMs,
      ingestionStartedAt
    )).toMatchObject({
      status: 'unhealthy',
      connected: false,
      error: 'WebSocket not connected',
    });
  });

  it('returns only redacted status for public health when database is down', async () => {
    healthDbQueryMock.mockRejectedValue(new Error('db down'));
    redisPingMock.mockResolvedValue('PONG');

    const status = await getPublicHealthStatus();

    expect(status).toEqual({ status: 'degraded' });
    expect(status).not.toHaveProperty('components');
    expect(status).not.toHaveProperty('timestamp');
  });

  it('returns only redacted status for public health when jetstream provider throws', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => {
      throw new Error('jetstream probe failed');
    });
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const status = await getPublicHealthStatus();

    expect(status).toEqual({ status: 'degraded' });
    expect(status).not.toHaveProperty('components');
    expect(status).not.toHaveProperty('timestamp');
  });

  it('returns detailed diagnostics for admin health', async () => {
    healthDbQueryMock.mockRejectedValue(new Error('db down'));
    redisPingMock.mockResolvedValue('PONG');

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'unhealthy',
        components: {
          database: {
            status: 'unhealthy',
            error: 'db down',
          },
          redis: {
            status: 'healthy',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns degraded admin health when only jetstream is unhealthy', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => ({
      status: 'unhealthy',
      connected: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        components: {
          database: {
            status: 'healthy',
          },
          jetstream: {
            status: 'unhealthy',
            connected: false,
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('surfaces stale cursor and queue backpressure details to operators', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => ({
      status: 'unhealthy',
      connected: true,
      cursor_us: '1783949494284543',
      cursor_lag_ms: 35_691_400,
      active_events: 20,
      pending_events: 100,
      inbound_paused: true,
      pause_count: 12,
      resume_count: 11,
      overload_reconnect_count: 0,
      total_dropped_events: 0,
      error: 'Jetstream cursor is 35691s behind',
    }));

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        components: {
          jetstream: {
            status: 'unhealthy',
            connected: true,
            cursor_us: '1783949494284543',
            cursor_lag_ms: 35_691_400,
            active_events: 20,
            pending_events: 100,
            inbound_paused: true,
            pause_count: 12,
            resume_count: 11,
            overload_reconnect_count: 0,
            total_dropped_events: 0,
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns unhealthy admin health when database and jetstream are both unhealthy', async () => {
    healthDbQueryMock.mockRejectedValue(new Error('db down'));
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => ({
      status: 'unhealthy',
      connected: false,
    }));
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'unhealthy',
        components: {
          database: {
            status: 'unhealthy',
            error: 'db down',
          },
          jetstream: {
            status: 'unhealthy',
            connected: false,
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns degraded admin health when jetstream provider throws and critical components are healthy', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => {
      throw new Error('jetstream probe failed');
    });
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        components: {
          database: {
            status: 'healthy',
          },
          jetstream: {
            status: 'unhealthy',
            connected: false,
            error: 'jetstream probe failed',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns degraded admin health when jetstream health is not registered', async () => {
    vi.resetModules();

    const { registerScoringHealth: registerScoringHealthFresh } = await import('../src/lib/health.js');
    const { registerAdminHealthRoutes: registerAdminHealthRoutesFresh } = await import('../src/admin/routes/health.js');

    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerScoringHealthFresh(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutesFresh(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        components: {
          jetstream: {
            status: 'unhealthy',
            connected: false,
            error: 'Jetstream health check not registered',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns only redacted status for public health when jetstream health is not registered', async () => {
    vi.resetModules();

    const {
      getPublicHealthStatus: getPublicHealthStatusFresh,
      registerScoringHealth: registerScoringHealthFresh,
    } = await import('../src/lib/health.js');

    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerScoringHealthFresh(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const status = await getPublicHealthStatusFresh();

    expect(status).toEqual({ status: 'degraded' });
    expect(status).not.toHaveProperty('components');
    expect(status).not.toHaveProperty('timestamp');
  });
});
