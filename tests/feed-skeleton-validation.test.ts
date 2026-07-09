import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    eval: vi.fn(),
    incr: vi.fn(),
    del: vi.fn(),
    setex: vi.fn(),
    get: vi.fn(),
    pttl: vi.fn(),
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
import { decodeCursor } from '../src/feed/cursor.js';
import { __resetFeedRequestTrackerForTests, drainFeedRequestTracker } from '../src/feed/request-tracker.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';
import { clearCurrentFeedSnapshotMemoryCache } from '../src/feed/snapshot-cache.js';
import { buildTestApp } from './helpers/index.js';

describe('getFeedSkeleton query validation', () => {
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.eval.mockResolvedValue(1);
    redisMock.incr.mockResolvedValue(1);
    redisMock.del.mockResolvedValue(1);
    redisMock.setex.mockResolvedValue('OK');
    redisMock.pttl.mockResolvedValue(300_000);
    redisMock.get.mockResolvedValue(null);
    dbQueryMock.mockReset();
  });

  afterEach(async () => {
    await drainFeedRequestTracker(1000);
    __resetFeedRequestTrackerForTests();
    clearCurrentFeedSnapshotMemoryCache();
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

  it('returns 400 before Redis lookup when cursor snapshot id contains unsafe characters', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const cursor = Buffer.from(JSON.stringify({ s: 'snapshot with spaces', o: 0 })).toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'ValidationError',
    });
    expect(redisMock.get).not.toHaveBeenCalledWith('snapshot:snapshot with spaces');

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

  it('reuses parsed snapshot data for repeated cursor pagination', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const allUris = Array.from(
      { length: 200 },
      (_, index) => `at://did:plc:testauthor/app.bsky.feed.post/${index + 1}`
    );
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'snapshot:snap') return Promise.resolve(JSON.stringify(allUris));
      if (key === 'feed:epoch') return Promise.resolve('1');
      return Promise.resolve(null);
    });

    const cursor = Buffer.from(JSON.stringify({ s: 'snap', o: 150 })).toString('base64url');
    const url = `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=${encodeURIComponent(cursor)}&limit=5`;

    const firstResponse = await app.inject({ method: 'GET', url });
    const secondResponse = await app.inject({ method: 'GET', url });

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    const snapshotReads = redisMock.get.mock.calls.filter(([key]) => key === 'snapshot:snap');
    expect(snapshotReads).toHaveLength(1);

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

  it('treats an empty cursor query as the first page', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    redisMock.get.mockImplementation((key: string) => {
      if (key === 'bot:latest_announcement') {
        return Promise.resolve(JSON.stringify({ uri: 'at://did:plc:bot/app.bsky.feed.post/pinned' }));
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=&limit=1`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().feed).toEqual([
      { post: 'at://did:plc:bot/app.bsky.feed.post/pinned' },
    ]);

    await app.close();
  });

  it('fails open with an empty feed when the current snapshot cache read rejects', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    redisMock.pttl.mockRejectedValueOnce(new Error('redis pttl unavailable'));

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feed: [] });

    await app.close();
  });

  it('does not skip ranked posts when a pinned announcement displaces the first page', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
      'at://did:plc:testauthor/app.bsky.feed.post/3',
    ]);
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'bot:latest_announcement') {
        return Promise.resolve(JSON.stringify({ uri: 'at://did:plc:bot/app.bsky.feed.post/pinned' }));
      }
      if (key === 'feed:epoch') return Promise.resolve('1');
      return Promise.resolve(null);
    });

    const firstResponse = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });
    const firstBody = firstResponse.json() as { feed: Array<{ post: string }>; cursor?: string };

    expect(firstBody.feed.map((item) => item.post)).toEqual([
      'at://did:plc:bot/app.bsky.feed.post/pinned',
      'at://did:plc:testauthor/app.bsky.feed.post/1',
    ]);
    expect(firstBody.cursor).toBeDefined();
    expect(decodeCursor(firstBody.cursor as string)?.offset).toBe(1);

    const secondResponse = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2&cursor=${encodeURIComponent(firstBody.cursor as string)}`,
    });
    const secondBody = secondResponse.json() as { feed: Array<{ post: string }> };

    expect(secondBody.feed.map((item) => item.post)).toEqual([
      'at://did:plc:testauthor/app.bsky.feed.post/2',
      'at://did:plc:testauthor/app.bsky.feed.post/3',
    ]);

    await app.close();
  });

  it('does not repeat a pinned announcement when limit one leaves the ranked offset at zero', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'bot:latest_announcement') {
        return Promise.resolve(JSON.stringify({ uri: 'at://did:plc:bot/app.bsky.feed.post/pinned' }));
      }
      if (key === 'feed:epoch') return Promise.resolve('1');
      return Promise.resolve(null);
    });

    const firstResponse = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=1`,
    });
    const firstBody = firstResponse.json() as { feed: Array<{ post: string }>; cursor?: string };

    expect(firstBody.feed.map((item) => item.post)).toEqual([
      'at://did:plc:bot/app.bsky.feed.post/pinned',
    ]);
    expect(firstBody.cursor).toBeDefined();
    expect(decodeCursor(firstBody.cursor as string)?.offset).toBe(0);

    const secondResponse = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=1&cursor=${encodeURIComponent(firstBody.cursor as string)}`,
    });
    const secondBody = secondResponse.json() as { feed: Array<{ post: string }>; cursor?: string };

    expect(secondBody.feed.map((item) => item.post)).toEqual([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
    ]);
    expect(decodeCursor(secondBody.cursor as string)?.offset).toBe(1);

    await app.close();
  });
});
