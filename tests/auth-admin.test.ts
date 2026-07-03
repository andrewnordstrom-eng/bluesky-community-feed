import Fastify, { FastifyRequest } from 'fastify';
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
  // Run getAdminDid inside a real Fastify request, preseeding request.adminDid
  // the way requireAdmin would (or not), and report the outcome — including the
  // thrown error's message, so error-path assertions can check identity, not
  // just that *something* threw.
  async function callGetAdminDid(
    preset: (request: FastifyRequest) => void
  ): Promise<{ ok: boolean; did?: string; message?: string }> {
    const app = Fastify();
    app.get('/t', (request, reply) => {
      preset(request);
      try {
        return reply.send({ ok: true, did: getAdminDid(request) });
      } catch (err) {
        return reply.send({ ok: false, message: (err as Error).message });
      }
    });
    const res = await app.inject({ method: 'GET', url: '/t' });
    await app.close();
    return res.json() as { ok: boolean; did?: string; message?: string };
  }

  it('returns the admin DID once requireAdmin has attached it', async () => {
    const out = await callGetAdminDid((request) => {
      request.adminDid = 'did:plc:admin'; // requireAdmin sets this on success
    });
    expect(out.ok).toBe(true);
    expect(out.did).toBe('did:plc:admin');
  });

  it('throws the wiring-bug error if called before requireAdmin attached the DID', async () => {
    const out = await callGetAdminDid(() => {
      /* requireAdmin never ran → request.adminDid stays undefined */
    });
    expect(out.ok).toBe(false);
    // Assert the specific wiring-bug error, not merely that it threw: a
    // regression that throws an unrelated error (e.g. a TypeError from a wrong
    // code path) must fail this test rather than pass it.
    expect(out.message).toMatch(/requireAdmin|adminDid/i);
  });

  it('throws on a falsy-but-set empty-string DID (guard is truthiness, not === undefined)', async () => {
    // requireAdmin only ever assigns a truthy DID (it 401s when `!did`), so an
    // empty string can never be a legitimately-attached admin DID. getAdminDid's
    // `!request.adminDid` guard must therefore reject '' as well — pin that so
    // the guard can't be silently loosened to `=== undefined`, which would let
    // an empty-string DID leak through as if authenticated.
    const out = await callGetAdminDid((request) => {
      request.adminDid = '';
    });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/requireAdmin|adminDid/i);
  });
});
