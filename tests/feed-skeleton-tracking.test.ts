import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import {
  __resetFeedRequestTrackerForTests,
  __setFeedRequestTrackerTaskTimeoutForTests,
  drainFeedRequestTracker,
} from '../src/feed/request-tracker.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';
import { clearCurrentFeedSnapshotMemoryCache } from '../src/feed/snapshot-cache.js';
import { buildTestApp } from './helpers/index.js';

const {
  redisMock,
  dbQueryMock,
  verifyFeedRequesterDidMock,
  pipelineMock,
  pipelineRpushMock,
  pipelineLtrimMock,
  pipelineExecMock,
} = vi.hoisted(() => {
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
  verifyFeedRequesterDidMock: vi.fn(),
   pipelineMock,
   pipelineRpushMock,
   pipelineLtrimMock,
   pipelineExecMock,
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

vi.mock('../src/feed/jwt-verifier.js', () => ({
  verifyFeedRequesterDid: verifyFeedRequesterDidMock,
}));

const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

describe('getFeedSkeleton tracking', () => {
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
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'feed:epoch') return Promise.resolve('2');
      return Promise.resolve(null);
    });
    verifyFeedRequesterDidMock.mockResolvedValue(null);
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    pipelineMock.mockClear();
    pipelineRpushMock.mockClear();
    pipelineLtrimMock.mockClear();
    pipelineExecMock.mockClear();
  });

  afterEach(async () => {
    await drainFeedRequestTracker(1000);
    __resetFeedRequestTrackerForTests();
    clearCurrentFeedSnapshotMemoryCache();
  });

  it('treats unverified JWT as anonymous and skips subscriber upsert', async () => {
    verifyFeedRequesterDidMock.mockResolvedValueOnce(null);

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer forged.jwt.token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().feed).toHaveLength(2);

    await drainFeedRequestTracker(1000);

    expect(verifyFeedRequesterDidMock).toHaveBeenCalledWith('Bearer forged.jwt.token');
    expect(dbQueryMock).not.toHaveBeenCalled();
    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineRpushMock).toHaveBeenCalledTimes(1);
    expect(pipelineLtrimMock).toHaveBeenCalledWith('feed:request_log', -100000, -1);
    expect(pipelineExecMock).toHaveBeenCalledTimes(1);

    const [, rawLogEntry] = pipelineRpushMock.mock.calls[0];
    const logEntry = JSON.parse(rawLogEntry as string);
    expect(logEntry.viewer_did).toBeNull();

    await app.close();
  });

  it('tracks verified DID for subscriber upsert and request logging', async () => {
    verifyFeedRequesterDidMock.mockResolvedValueOnce('did:plc:verified-user');

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer valid.verified.jwt',
      },
    });

    expect(response.statusCode).toBe(200);

    await drainFeedRequestTracker(1000);

    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain('INSERT INTO subscribers');
    expect(dbQueryMock.mock.calls[0][1]).toEqual(['did:plc:verified-user']);

    expect(pipelineRpushMock).toHaveBeenCalledTimes(1);
    const [, rawLogEntry] = pipelineRpushMock.mock.calls[0];
    const logEntry = JSON.parse(rawLogEntry as string);
    expect(logEntry.viewer_did).toBe('did:plc:verified-user');
    expect(logEntry.epoch_id).toBe(2);

    await app.close();
  });

  it.each([
    'Bearer malformed.jwt',
    'Bearer expired.jwt',
    'Bearer unverifiable.jwt',
  ])('logs %s as anonymous when verifier rejects', async (authorization) => {
    verifyFeedRequesterDidMock.mockResolvedValueOnce(null);

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);

    await drainFeedRequestTracker(1000);

    expect(dbQueryMock).not.toHaveBeenCalled();
    const [, rawLogEntry] = pipelineRpushMock.mock.calls.at(-1) as [string, string];
    const logEntry = JSON.parse(rawLogEntry);
    expect(logEntry.viewer_did).toBeNull();

    await app.close();
  });

  it('logs only the posts served when a pinned announcement displaces a ranked post', async () => {
    redisMock.zrevrange.mockResolvedValueOnce([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
      'at://did:plc:testauthor/app.bsky.feed.post/3',
    ]);
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'bot:latest_announcement') {
        return Promise.resolve(JSON.stringify({ uri: 'at://did:plc:bot/app.bsky.feed.post/pinned' }));
      }
      if (key === 'feed:epoch') return Promise.resolve('2');
      return Promise.resolve(null);
    });

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().feed).toHaveLength(2);

    await drainFeedRequestTracker(1000);

    const [, rawLogEntry] = pipelineRpushMock.mock.calls.at(-1) as [string, string];
    const logEntry = JSON.parse(rawLogEntry);
    expect(logEntry.posts_served).toBe(2);
    expect(logEntry.post_uris).toEqual([
      'at://did:plc:bot/app.bsky.feed.post/pinned',
      'at://did:plc:testauthor/app.bsky.feed.post/1',
    ]);

    await app.close();
  });

  it('tracks limit-one pinned pagination without redisplaying the pinned URI', async () => {
    redisMock.zrevrange.mockResolvedValueOnce([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'bot:latest_announcement') {
        return Promise.resolve(JSON.stringify({ uri: 'at://did:plc:bot/app.bsky.feed.post/pinned' }));
      }
      if (key === 'feed:epoch') return Promise.resolve('2');
      return Promise.resolve(null);
    });

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const firstResponse = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=1`,
    });
    const firstBody = firstResponse.json() as { feed: Array<{ post: string }>; cursor?: string };
    expect(firstBody.feed.map((item) => item.post)).toEqual([
      'at://did:plc:bot/app.bsky.feed.post/pinned',
    ]);
    expect(firstBody.cursor).toBeDefined();

    const secondResponse = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=1&cursor=${encodeURIComponent(firstBody.cursor as string)}`,
    });
    const secondBody = secondResponse.json() as { feed: Array<{ post: string }> };
    expect(secondBody.feed.map((item) => item.post)).toEqual([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
    ]);

    await drainFeedRequestTracker(1000);

    const logEntries = pipelineRpushMock.mock.calls.map(([, rawLogEntry]) => JSON.parse(String(rawLogEntry)));
    expect(logEntries.at(-2)).toMatchObject({
      posts_served: 1,
      page_offset: 0,
      post_uris: ['at://did:plc:bot/app.bsky.feed.post/pinned'],
    });
    expect(logEntries.at(-1)).toMatchObject({
      posts_served: 1,
      page_offset: 0,
      post_uris: ['at://did:plc:testauthor/app.bsky.feed.post/1'],
    });

    await app.close();
  });

  it('times out stalled tracking Redis reads and releases the tracker slot', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'feed:epoch') {
        return new Promise<null>(() => {
          // Intentionally never resolves: this simulates a stalled tracking-only Redis read.
        });
      }
      return Promise.resolve(null);
    });

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });

    expect(response.statusCode).toBe(200);

    const stats = await drainFeedRequestTracker(1000);
    expect(stats.timedOut).toBe(1);
    expect(stats.inFlight).toBe(0);
    expect(stats.queued).toBe(0);
    expect(pipelineExecMock).not.toHaveBeenCalled();

    await app.close();
  });
});
