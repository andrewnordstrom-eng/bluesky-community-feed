import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    setex: vi.fn(),
    get: vi.fn(),
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

describe('getFeedSkeleton auth handling', () => {
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

  beforeEach(() => {
    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.setex.mockResolvedValue('OK');
    redisMock.get.mockImplementation((key: string) => {
      if (key === 'feed:epoch') return Promise.resolve('1');
      return Promise.resolve(null);
    });
    verifyFeedRequesterDidMock.mockResolvedValue(null);
    dbQueryMock.mockReset();
  });

  it('returns 200 without auth header', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.feed).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(verifyFeedRequesterDidMock).toHaveBeenCalledWith(undefined);

    await app.close();
  });

  it('returns 200 with malformed auth header', async () => {
    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer malformed',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.feed).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(verifyFeedRequesterDidMock).toHaveBeenCalledWith('Bearer malformed');

    await app.close();
  });
});
