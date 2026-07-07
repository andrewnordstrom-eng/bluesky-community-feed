import { describe, expect, it, vi } from 'vitest';
import { __resetFeedRequestTrackerForTests, drainFeedRequestTracker } from '../src/feed/request-tracker.js';
import { clearCurrentFeedSnapshotMemoryCache } from '../src/feed/snapshot-cache.js';

const { redisMock, dbQueryMock, verifyFeedRequesterDidMock } = vi.hoisted(() => {
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

import { config } from '../src/config.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';
import { buildTestApp } from './helpers/index.js';

describe('getFeedSkeleton requester auth hot path', () => {
  it('returns 200 without blocking on requester auth verification', async () => {
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
      if (key === 'feed:epoch') return Promise.resolve('1');
      return Promise.resolve(null);
    });
    let resolveVerifier: ((value: string | null) => void) | null = null;
    verifyFeedRequesterDidMock.mockImplementation(
      () => new Promise<string | null>((resolve) => {
        resolveVerifier = resolve;
      })
    );

    const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const startedAt = Date.now();
    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer very.slow.token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().feed).toHaveLength(2);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolveVerifier).not.toBeNull();

    resolveVerifier?.(null);
    await drainFeedRequestTracker(1000);
    __resetFeedRequestTrackerForTests();
    clearCurrentFeedSnapshotMemoryCache();

    await app.close();
  });
});
