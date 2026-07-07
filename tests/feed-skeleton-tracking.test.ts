import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import {
  __resetFeedRequestTrackerForTests,
  __setFeedRequestTrackerTaskTimeoutForTests,
  drainFeedRequestTracker,
  getFeedRequestTrackerStats,
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
  loggerWarnMock,
  loggerDebugMock,
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
  loggerWarnMock: vi.fn(),
  loggerDebugMock: vi.fn(),
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

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    debug: loggerDebugMock,
    warn: loggerWarnMock,
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

async function waitForTrackerTimeout(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
}

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
    pipelineExecMock.mockReset();
    pipelineExecMock.mockResolvedValue([]);
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

  it('keeps stalled tracking Redis reads accounted until the backend operation settles', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    let resolveFeedEpochRead: ((value: null) => void) | null = null;
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'feed:epoch') {
        return new Promise<null>((resolve) => {
          resolveFeedEpochRead = resolve;
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

    await waitForTrackerTimeout();
    const timedOutStats = getFeedRequestTrackerStats();
    expect(timedOutStats.timedOut).toBe(1);
    expect(timedOutStats.inFlight).toBe(0);
    expect(timedOutStats.queued).toBe(0);
    expect(timedOutStats.abandonedBackendOps).toBe(1);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);
    expect(pipelineExecMock).not.toHaveBeenCalled();

    resolveFeedEpochRead?.(null);
    const stats = await drainFeedRequestTracker(1000);
    expect(stats.abandonedBackendOps).toBe(0);
    expect(stats.maxAbandonedBackendOpsObserved).toBe(1);

    await app.close();
  });

  it('keeps stalled feed requester verification accounted until the verifier settles', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    let resolveStalledVerifier: ((value: null) => void) | null = null;
    verifyFeedRequesterDidMock.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolveStalledVerifier = resolve;
          // Intentionally never resolves: this simulates a stalled auth verifier.
        })
    );

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer stalled.verifier.jwt',
      },
    });

    expect(response.statusCode).toBe(200);

    await waitForTrackerTimeout();
    const timedOutStats = getFeedRequestTrackerStats();
    expect(timedOutStats.timedOut).toBe(1);
    expect(timedOutStats.inFlight).toBe(0);
    expect(timedOutStats.queued).toBe(0);
    expect(timedOutStats.abandonedBackendOps).toBe(1);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);
    expect(pipelineExecMock).not.toHaveBeenCalled();

    resolveStalledVerifier?.(null);
    const stats = await drainFeedRequestTracker(1000);
    expect(stats.abandonedBackendOps).toBe(0);
    expect(stats.maxAbandonedBackendOpsObserved).toBe(1);

    await app.close();
  });

  it('keeps stalled subscriber upserts accounted until the backend operation settles', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    verifyFeedRequesterDidMock.mockResolvedValueOnce('did:plc:verified-user');
    let rejectStalledUpsert: ((error: Error) => void) | null = null;
    dbQueryMock.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectStalledUpsert = reject;
          // Intentionally never resolves: this simulates a stalled subscriber write.
        })
    );

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

    await waitForTrackerTimeout();
    const timedOutStats = getFeedRequestTrackerStats();
    expect(timedOutStats.timedOut).toBe(1);
    expect(timedOutStats.inFlight).toBe(0);
    expect(timedOutStats.queued).toBe(0);
    expect(timedOutStats.abandonedBackendOps).toBe(1);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(pipelineExecMock).toHaveBeenCalledTimes(1);

    rejectStalledUpsert?.(new Error('subscriber write settled after timeout'));
    const stats = await drainFeedRequestTracker(1000);
    expect(stats.abandonedBackendOps).toBe(0);
    expect(stats.maxAbandonedBackendOpsObserved).toBe(1);

    await app.close();
  });

  it('keeps stalled tracking pipeline writes accounted until the backend operation settles', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    let resolvePipelineWrite: ((value: []) => void) | null = null;
    pipelineExecMock.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          resolvePipelineWrite = resolve;
          // Intentionally never resolves: this simulates a stalled tracking-only Redis write.
        })
    );

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });

    expect(response.statusCode).toBe(200);

    await waitForTrackerTimeout();
    const timedOutStats = getFeedRequestTrackerStats();
    expect(timedOutStats.timedOut).toBe(1);
    expect(timedOutStats.inFlight).toBe(0);
    expect(timedOutStats.queued).toBe(0);
    expect(timedOutStats.abandonedBackendOps).toBe(1);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);
    expect(pipelineExecMock).toHaveBeenCalledTimes(1);

    resolvePipelineWrite?.([]);
    const stats = await drainFeedRequestTracker(1000);
    expect(stats.abandonedBackendOps).toBe(0);
    expect(stats.maxAbandonedBackendOpsObserved).toBe(1);

    await app.close();
  });

  it('records tracking pipeline write rejection as a failure without blocking the response', async () => {
    verifyFeedRequesterDidMock.mockResolvedValueOnce('did:plc:verified-user');
    pipelineExecMock.mockRejectedValueOnce(new Error('tracking pipeline write failed'));

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

    const stats = await drainFeedRequestTracker(1000);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(1);
    expect(stats.timedOut).toBe(0);
    expect(stats.inFlight).toBe(0);
    expect(stats.queued).toBe(0);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(pipelineExecMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        failed: 1,
      }),
      'Feed request tracking task failed'
    );
    expect(loggerWarnMock).not.toHaveBeenCalledWith(expect.anything(), 'Failed to log feed request to Redis');

    await app.close();
  });

  it('rate-limits repeated tracking failure warnings through the tracker', async () => {
    pipelineExecMock.mockRejectedValue(new Error('tracking pipeline write failed'));

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const responses = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      }),
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      }),
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);

    const stats = await drainFeedRequestTracker(1000);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(3);
    expect(stats.timedOut).toBe(0);
    expect(stats.inFlight).toBe(0);
    expect(stats.queued).toBe(0);
    expect(pipelineExecMock).toHaveBeenCalledTimes(3);

    const warningMessages = loggerWarnMock.mock.calls.map(([_context, message]) => message);
    expect(warningMessages.filter((message) => message === 'Feed request tracking task failed')).toHaveLength(1);
    expect(warningMessages).not.toContain('Failed to log feed request to Redis');

    await app.close();
  });

  it('keeps healthy concurrent tracking requests moving when a subscriber upsert settles late', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    verifyFeedRequesterDidMock.mockResolvedValueOnce('did:plc:verified-user');
    let rejectStalledUpsert: ((error: Error) => void) | null = null;
    dbQueryMock.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectStalledUpsert = reject;
        })
    );

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const [stalledResponse, healthyResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
        headers: {
          authorization: 'Bearer valid.verified.jwt',
        },
      }),
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      }),
    ]);

    expect(stalledResponse.statusCode).toBe(200);
    expect(healthyResponse.statusCode).toBe(200);

    await waitForTrackerTimeout();
    const timedOutStats = getFeedRequestTrackerStats();
    expect(timedOutStats.completed).toBe(1);
    expect(timedOutStats.timedOut).toBe(1);
    expect(timedOutStats.inFlight).toBe(0);
    expect(timedOutStats.queued).toBe(0);
    expect(timedOutStats.abandonedBackendOps).toBe(1);
    expect(pipelineExecMock).toHaveBeenCalledTimes(2);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);

    rejectStalledUpsert?.(new Error('subscriber write settled after timeout'));
    const drainedStats = await drainFeedRequestTracker(1000);
    expect(drainedStats.completed).toBe(1);
    expect(drainedStats.timedOut).toBe(1);
    expect(drainedStats.abandonedBackendOps).toBe(0);
    expect(drainedStats.maxAbandonedBackendOpsObserved).toBe(1);

    await app.close();
  });

  it('rate-limits repeated subscriber upsert stall warnings through the tracker', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    verifyFeedRequesterDidMock.mockResolvedValue('did:plc:verified-user');
    const rejectStalledUpserts: Array<(error: Error) => void> = [];
    dbQueryMock.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectStalledUpserts.push(reject);
        })
    );

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const responses = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
        headers: {
          authorization: 'Bearer valid.verified.jwt',
        },
      }),
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
        headers: {
          authorization: 'Bearer valid.verified.jwt',
        },
      }),
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
        headers: {
          authorization: 'Bearer valid.verified.jwt',
        },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);

    await waitForTrackerTimeout();
    const timedOutStats = getFeedRequestTrackerStats();
    expect(timedOutStats.completed).toBe(0);
    expect(timedOutStats.failed).toBe(0);
    expect(timedOutStats.timedOut).toBe(3);
    expect(timedOutStats.inFlight).toBe(0);
    expect(timedOutStats.queued).toBe(0);
    expect(timedOutStats.abandonedBackendOps).toBe(3);
    expect(dbQueryMock).toHaveBeenCalledTimes(3);
    expect(pipelineExecMock).toHaveBeenCalledTimes(3);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);

    const warningMessages = loggerWarnMock.mock.calls.map(([_context, message]) => message);
    expect(warningMessages.filter((message) => message === 'Feed request tracking task timed out')).toHaveLength(1);
    expect(warningMessages).not.toContain('Failed to log feed request to Redis');

    for (const rejectStalledUpsert of rejectStalledUpserts) {
      rejectStalledUpsert(new Error('late subscriber write failure'));
    }
    const stats = await drainFeedRequestTracker(1000);
    expect(stats.abandonedBackendOps).toBe(0);
    expect(stats.abandonedBackendOpsTotal).toBe(3);
    expect(stats.maxAbandonedBackendOpsObserved).toBe(3);

    await app.close();
  });

  it('does not double-count concurrent verifier and subscriber stalls that settle late', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    let resolveStalledVerifier: ((did: string) => void) | null = null;
    let rejectStalledUpsert: ((error: Error) => void) | null = null;
    verifyFeedRequesterDidMock
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveStalledVerifier = resolve;
          })
      )
      .mockResolvedValueOnce('did:plc:verified-user');
    dbQueryMock.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectStalledUpsert = reject;
        })
    );

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const [stalledVerifierResponse, stalledUpsertResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
        headers: {
          authorization: 'Bearer stalled.verifier.jwt',
        },
      }),
      app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
        headers: {
          authorization: 'Bearer valid.verified.jwt',
        },
      }),
    ]);

    expect(stalledVerifierResponse.statusCode).toBe(200);
    expect(stalledUpsertResponse.statusCode).toBe(200);

    await waitForTrackerTimeout();
    const timedOutStats = getFeedRequestTrackerStats();
    expect(timedOutStats.timedOut).toBe(2);
    expect(timedOutStats.failed).toBe(0);
    expect(timedOutStats.inFlight).toBe(0);
    expect(timedOutStats.queued).toBe(0);
    expect(timedOutStats.abandonedBackendOps).toBe(2);
    expect(pipelineExecMock).toHaveBeenCalledTimes(1);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);

    resolveStalledVerifier?.('did:plc:late-verifier');
    rejectStalledUpsert?.(new Error('late subscriber write failure'));
    const drainedStats = await drainFeedRequestTracker(1000);
    expect(drainedStats.abandonedBackendOps).toBe(0);
    expect(drainedStats.abandonedBackendOpsTotal).toBe(2);
    expect(drainedStats.maxAbandonedBackendOpsObserved).toBe(2);

    await app.close();
  });
});
