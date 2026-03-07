import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

async function loadDebugRoutesForEnv(nodeEnv: 'production' | 'development') {
  vi.resetModules();

  const requireAdminMock = vi.fn(async (_request: unknown, reply: { status: (code: number) => { send: (body: unknown) => void } }) => {
    reply.status(401).send({ error: 'Authentication required' });
  });
  const dbQueryMock = vi.fn();
  const redisZCardMock = vi.fn();
  const getCurrentContentRulesMock = vi.fn();
  const checkContentRulesMock = vi.fn();
  const filterPostsMock = vi.fn();

  vi.doMock('../src/config.js', () => ({
    config: {
      NODE_ENV: nodeEnv,
    },
  }));

  vi.doMock('../src/auth/admin.js', () => ({
    requireAdmin: requireAdminMock,
  }));

  vi.doMock('../src/db/client.js', () => ({
    db: {
      query: dbQueryMock,
    },
  }));

  vi.doMock('../src/db/redis.js', () => ({
    redis: {
      zcard: redisZCardMock,
    },
  }));

  vi.doMock('../src/governance/content-filter.js', () => ({
    getCurrentContentRules: getCurrentContentRulesMock,
    checkContentRules: checkContentRulesMock,
    filterPosts: filterPostsMock,
  }));

  const module = await import('../src/feed/routes/debug.js');

  return {
    registerDebugRoutes: module.registerDebugRoutes,
    requireAdminMock,
    dbQueryMock,
    redisZCardMock,
  };
}

describe('debug route access control', () => {
  it('requires admin auth in production', async () => {
    const { registerDebugRoutes, requireAdminMock, dbQueryMock } = await loadDebugRoutesForEnv('production');

    const app = Fastify();
    registerDebugRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/debug/scoring-weights',
    });

    expect(response.statusCode).toBe(401);
    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('also requires admin auth in development (security hardening)', async () => {
    const { registerDebugRoutes, requireAdminMock } = await loadDebugRoutesForEnv('development');

    const app = Fastify();
    registerDebugRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/debug/scoring-weights',
    });

    // Debug routes now require admin auth unconditionally — no environment bypass
    expect(response.statusCode).toBe(401);
    expect(requireAdminMock).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
