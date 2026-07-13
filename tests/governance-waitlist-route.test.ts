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

  it('accepts values at the exact caps and rejects one past them', async () => {
    const app = buildApp();

    // Note: exactly 500 passes, 501 fails (the 501 case is covered below).
    const note = 'x'.repeat(500);
    const noteResponse = await submit(app, { handle: 'alice.bsky.social', note });
    expect(noteResponse.statusCode).toBe(200);
    expect(queryMock.mock.calls[0][1]).toEqual(['alice.bsky.social', note]);

    // Handle: build valid domain-format handles that land exactly on and one
    // past the 253-char cap, so a regression like .max(200) is caught.
    const handle253 = `${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(61)}`;
    expect(handle253).toHaveLength(253);
    const handle254 = `${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(62)}`;
    expect(handle254).toHaveLength(254);

    expect((await submit(app, { handle: handle253 })).statusCode).toBe(200);
    expect((await submit(app, { handle: handle254 })).statusCode).toBe(400);
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
