import Fastify from 'fastify';
import { describe, it, expect, vi } from 'vitest';

// getAdminDid only reads request.adminDid, so stub the module's transitive
// imports (config/logger/session store) to keep this a focused unit test.
vi.mock('../src/config.js', () => ({
  config: { BOT_ADMIN_DIDS: 'did:plc:admin' },
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/governance/auth.js', () => ({
  getSession: vi.fn(),
  SessionStoreUnavailableError: class SessionStoreUnavailableError extends Error {},
}));

import { getAdminDid } from '../src/auth/admin.js';

describe('getAdminDid', () => {
  it('returns the admin DID once requireAdmin has attached it', async () => {
    const app = Fastify();
    app.get('/t', (request, reply) => {
      request.adminDid = 'did:plc:admin'; // requireAdmin sets this on success
      return reply.send({ did: getAdminDid(request) });
    });
    const res = await app.inject({ method: 'GET', url: '/t' });
    expect(res.statusCode).toBe(200);
    expect(res.json().did).toBe('did:plc:admin');
    await app.close();
  });

  it('throws (fail-fast) if called before requireAdmin attached the DID', async () => {
    const app = Fastify();
    app.get('/t', (request, reply) => {
      let threw = false;
      try {
        getAdminDid(request);
      } catch {
        threw = true;
      }
      return reply.send({ threw });
    });
    const res = await app.inject({ method: 'GET', url: '/t' });
    expect(res.json().threw).toBe(true);
    await app.close();
  });
});
