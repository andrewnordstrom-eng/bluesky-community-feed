import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, resolveHandleMock, invalidateCacheMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  resolveHandleMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: queryMock },
}));

vi.mock('../src/admin/routes/resolve-handle.js', () => ({
  resolveHandleToDid: resolveHandleMock,
}));

vi.mock('../src/feed/access-control.js', () => ({
  isParticipantApproved: vi.fn(),
  invalidateParticipantCache: invalidateCacheMock,
}));

import { registerWaitlistRoutes } from '../src/admin/routes/waitlist.js';

const ADMIN_DID = 'did:plc:admin';

/** Bare app standing in for the admin scope: requireAdmin is exercised
 *  elsewhere; here we attach adminDid the way the preHandler would. */
function buildApp() {
  const app = Fastify();
  app.addHook('preHandler', async (request: FastifyRequest) => {
    (request as FastifyRequest & { adminDid: string }).adminDid = ADMIN_DID;
  });
  registerWaitlistRoutes(app);
  return app;
}

const PENDING_ROW = {
  id: 7,
  handle: 'alice.bsky.social',
  did: null,
  note: 'birder',
  status: 'pending',
  created_at: '2026-07-13T00:00:00.000Z',
  decided_at: null,
  decided_by: null,
};

describe('admin waitlist routes', () => {
  beforeEach(() => {
    queryMock.mockReset();
    resolveHandleMock.mockReset();
    invalidateCacheMock.mockReset();
    invalidateCacheMock.mockResolvedValue(undefined);
  });

  it('GET /waitlist defaults to pending, oldest first', async () => {
    queryMock.mockResolvedValue({ rows: [PENDING_ROW] });
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/waitlist' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requests: [PENDING_ROW], total: 1 });
    expect(queryMock.mock.calls[0][0]).toContain("status = $1");
    expect(queryMock.mock.calls[0][1]).toEqual(['pending']);
    expect(queryMock.mock.calls[0][0]).toContain('ORDER BY created_at ASC');
  });

  it('GET /waitlist?status=all omits the filter', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/waitlist?status=all' });

    expect(response.statusCode).toBe(200);
    expect(queryMock.mock.calls[0][0]).not.toContain('WHERE');
  });

  it('GET /waitlist rejects an unknown status', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/waitlist?status=bogus' });
    expect(response.statusCode).toBe(400);
  });

  it('approve: resolves handle, upserts participant, marks row, invalidates cache, audits', async () => {
    resolveHandleMock.mockResolvedValue({ did: 'did:plc:alice', handle: 'alice.bsky.social' });
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 7, handle: 'alice.bsky.social', status: 'pending' }] }) // select
      .mockResolvedValueOnce({ rows: [] })  // participants upsert
      .mockResolvedValueOnce({ rows: [] })  // waitlist update
      .mockResolvedValueOnce({ rows: [] }); // audit insert
    const app = buildApp();

    const response = await app.inject({ method: 'POST', url: '/waitlist/7/approve' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, did: 'did:plc:alice', handle: 'alice.bsky.social' });

    const upsertCall = queryMock.mock.calls[1];
    expect(upsertCall[0]).toContain('INSERT INTO approved_participants');
    expect(upsertCall[0]).toContain('ON CONFLICT (did) DO UPDATE');
    expect(upsertCall[1]).toEqual(['did:plc:alice', 'alice.bsky.social', ADMIN_DID, 'waitlist #7']);

    const updateCall = queryMock.mock.calls[2];
    expect(updateCall[0]).toContain("SET status = 'approved'");
    expect(updateCall[1]).toEqual([7, 'did:plc:alice', ADMIN_DID]);

    expect(invalidateCacheMock).toHaveBeenCalledWith('did:plc:alice');

    const auditCall = queryMock.mock.calls[3];
    expect(auditCall[0]).toContain('governance_audit_log');
    expect(auditCall[1][0]).toBe('waitlist_approved');
    expect(auditCall[1][1]).toBe(ADMIN_DID);
  });

  it('approve: 404 for an unknown id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const app = buildApp();

    const response = await app.inject({ method: 'POST', url: '/waitlist/999/approve' });

    expect(response.statusCode).toBe(404);
  });

  it('approve: 409 when already decided', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 7, handle: 'alice.bsky.social', status: 'approved' }] });
    const app = buildApp();

    const response = await app.inject({ method: 'POST', url: '/waitlist/7/approve' });

    expect(response.statusCode).toBe(409);
  });

  it('approve: 400 when the handle cannot be resolved, and the row stays pending', async () => {
    resolveHandleMock.mockRejectedValue(new Error('resolution failed'));
    queryMock.mockResolvedValueOnce({ rows: [{ id: 7, handle: 'typo.example', status: 'pending' }] });
    const app = buildApp();

    const response = await app.inject({ method: 'POST', url: '/waitlist/7/approve' });

    expect(response.statusCode).toBe(400);
    // Only the initial SELECT ran — no upsert, no status update.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it('reject: marks pending row rejected and audits', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ handle: 'alice.bsky.social' }] }) // update returning
      .mockResolvedValueOnce({ rows: [] });                               // audit insert
    const app = buildApp();

    const response = await app.inject({ method: 'POST', url: '/waitlist/7/reject' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(queryMock.mock.calls[0][0]).toContain("SET status = 'rejected'");
    expect(queryMock.mock.calls[1][1][0]).toBe('waitlist_rejected');
  });

  it('reject: 404 unknown id, 409 already decided', async () => {
    const app = buildApp();

    queryMock
      .mockResolvedValueOnce({ rows: [] })  // update matched nothing
      .mockResolvedValueOnce({ rows: [] }); // existence check: not found
    const notFound = await app.inject({ method: 'POST', url: '/waitlist/999/reject' });
    expect(notFound.statusCode).toBe(404);

    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [] })                          // update matched nothing
      .mockResolvedValueOnce({ rows: [{ status: 'approved' }] });   // exists but decided
    const conflict = await app.inject({ method: 'POST', url: '/waitlist/7/reject' });
    expect(conflict.statusCode).toBe(409);
  });
});
