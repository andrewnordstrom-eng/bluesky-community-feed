import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import {
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

  it('returns only redacted status for public health when database is down', async () => {
    dbQueryMock.mockRejectedValue(new Error('db down'));
    redisPingMock.mockResolvedValue('PONG');

    const status = await getPublicHealthStatus();

    expect(status).toEqual({ status: 'degraded' });
    expect(status).not.toHaveProperty('components');
    expect(status).not.toHaveProperty('timestamp');
  });

  it('returns detailed diagnostics for admin health', async () => {
    dbQueryMock.mockRejectedValue(new Error('db down'));
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
    dbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
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

  it('returns unhealthy admin health when database and jetstream are both unhealthy', async () => {
    dbQueryMock.mockRejectedValue(new Error('db down'));
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
    dbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
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

    dbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
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
});
