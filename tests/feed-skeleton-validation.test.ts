import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redisMock, dbQueryMock } = vi.hoisted(() => {
  const pipelineRpushMock = vi.fn().mockReturnThis();
  const pipelineLtrimMock = vi.fn().mockReturnThis();
  const pipelineExecMock = vi.fn().mockResolvedValue([]);
  const pipelineMock = vi.fn(() => ({
    rpush: pipelineRpushMock,
    ltrim: pipelineLtrimMock,
    exec: pipelineExecMock,
  }));

  return {
  redisMock: {
    zrevrange: vi.fn(),
    setex: vi.fn(),
    get: vi.fn(),
    pipeline: pipelineMock,
  },
  dbQueryMock: vi.fn(),
  };
});

vi.mock('../src/db/redis.js', () => ({
  redis: redisMock,
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

import { config } from '../src/config.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';
import { buildTestApp } from './helpers/index.js';

describe('getFeedSkeleton query validation', () => {
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

  beforeEach(() => {
    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.setex.mockResolvedValue('OK');
    redisMock.get.mockResolvedValue(null);
    dbQueryMock.mockReset();
  });

  it.each(['0', '101', '2.5', 'abc'])(
    'returns 400 for invalid limit value %s',
    async (limit) => {
      const app = buildTestApp();
      registerFeedSkeleton(app);

      const response = await app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=${encodeURIComponent(limit)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'ValidationError',
      });

      await app.close();
    }
  );

  it('returns 400 for invalid cursor', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=not-a-valid-cursor`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'ValidationError',
    });

    await app.close();
  });

  it.each([
    { s: 'snap', o: 1.5 },
    { s: 'snap', o: '2' },
  ])('returns 400 for structurally invalid cursor payload %o', async (payload) => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const cursor = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'ValidationError',
    });

    await app.close();
  });

  it('returns empty feed for cursor offset above max bound', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const cursor = Buffer.from(JSON.stringify({ s: 'snap', o: 999999999 })).toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feed: [] });

    await app.close();
  });

  it('returns empty feed for cursor offset below min bound', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const cursor = Buffer.from(JSON.stringify({ s: 'snap', o: -1 })).toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feed: [] });

    await app.close();
  });

  it('supports in-range cursor offsets for pagination', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const allUris = Array.from(
      { length: 200 },
      (_, index) => `at://did:plc:testauthor/app.bsky.feed.post/${index + 1}`
    );
    redisMock.get.mockResolvedValueOnce(JSON.stringify(allUris));

    const cursor = Buffer.from(JSON.stringify({ s: 'snap', o: 150 })).toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=${encodeURIComponent(cursor)}&limit=5`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      feed: [
        { post: 'at://did:plc:testauthor/app.bsky.feed.post/151' },
        { post: 'at://did:plc:testauthor/app.bsky.feed.post/152' },
        { post: 'at://did:plc:testauthor/app.bsky.feed.post/153' },
        { post: 'at://did:plc:testauthor/app.bsky.feed.post/154' },
        { post: 'at://did:plc:testauthor/app.bsky.feed.post/155' },
      ],
    });

    await app.close();
  });

  it('returns 200 for valid query', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.feed).toHaveLength(2);

    await app.close();
  });
});
