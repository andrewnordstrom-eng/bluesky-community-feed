import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: queryMock },
}));

import { registerWaitlistRoute } from '../src/governance/routes/waitlist.js';

function buildApp() {
  const app = Fastify();
  registerWaitlistRoute(app);
  return app;
}

async function submit(app: ReturnType<typeof Fastify>, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/governance/waitlist',
    payload: payload as Record<string, unknown>,
  });
}

describe('POST /api/governance/waitlist', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  it('records a valid handle and returns the generic success body', async () => {
    const app = buildApp();
    const response = await submit(app, { handle: 'alice.bsky.social', note: 'birder here' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(typeof body.message).toBe('string');
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(['alice.bsky.social', 'birder here']);
  });

  it('normalizes leading @, whitespace, and case before insert', async () => {
    const app = buildApp();
    const response = await submit(app, { handle: '  @Alice.Example.COM ' });

    expect(response.statusCode).toBe(200);
    expect(queryMock.mock.calls[0][1]).toEqual(['alice.example.com', null]);
  });

  it('returns the identical generic body for a duplicate handle', async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    const app = buildApp();

    const fresh = await submit(app, { handle: 'alice.bsky.social' });
    const duplicate = await submit(app, { handle: 'alice.bsky.social' });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(fresh.json());
  });

  it('accepts the exact boundary values (500-char note, long valid handle)', async () => {
    const app = buildApp();
    const note = 'x'.repeat(500);
    // A valid multi-label handle near the 253-char cap (63-char labels).
    const longHandle = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.bsky.social`;

    const noteResponse = await submit(app, { handle: 'alice.bsky.social', note });
    expect(noteResponse.statusCode).toBe(200);
    expect(queryMock.mock.calls[0][1]).toEqual(['alice.bsky.social', note]);

    const handleResponse = await submit(app, { handle: longHandle });
    expect(handleResponse.statusCode).toBe(200);
    expect(longHandle.length).toBeLessThanOrEqual(253);
  });

  it('rejects malformed handles, DIDs, and oversized notes with 400', async () => {
    const app = buildApp();

    for (const payload of [
      { handle: 'not a handle' },
      { handle: 'did:plc:abc123' },
      { handle: 'nodots' },
      { handle: 'alice.bsky.social', note: 'x'.repeat(501) },
      { note: 'no handle at all' },
    ]) {
      const response = await submit(app, payload);
      expect(response.statusCode).toBe(400);
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts custom-domain handles', async () => {
    const app = buildApp();
    const response = await submit(app, { handle: 'andrew.corgi.network' });

    expect(response.statusCode).toBe(200);
    expect(queryMock.mock.calls[0][1]).toEqual(['andrew.corgi.network', null]);
  });

  it('returns 500 with a generic error when the insert fails', async () => {
    queryMock.mockRejectedValue(new Error('connection refused'));
    const app = buildApp();

    const response = await submit(app, { handle: 'alice.bsky.social' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('InternalError');
  });
});
