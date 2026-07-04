import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

import { registerPostExplainRoute } from '../src/transparency/routes/post-explain.js';

describe('post explain URI validation', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('returns 400 when post URI encoding is malformed', async () => {
    const app = Fastify();
    registerPostExplainRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/transparency/post/%E0%A4%A',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('continues normal flow for valid URI encoding', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerPostExplainRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/transparency/post/${encodeURIComponent('at://did:plc:user/app.bsky.feed.post/abc')}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'NotFound',
    });

    await app.close();
  });
});
