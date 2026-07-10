import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { redisMock, dbQueryMock, verifyFeedRequesterDidMock, isParticipantApprovedMock } = vi.hoisted(() => {
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
  isParticipantApprovedMock: vi.fn(),
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

vi.mock('../src/feed/access-control.js', () => ({
  isParticipantApproved: isParticipantApprovedMock,
}));

import { config } from '../src/config.js';
import {
  feedUriForCommunity,
  getFeedCommunities,
  resolveFeedCommunityByRkey,
  type FeedCommunity,
} from '../src/feed/community-registry.js';
import { __resetFeedRequestTrackerForTests, drainFeedRequestTracker } from '../src/feed/request-tracker.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';
import { clearCurrentFeedSnapshotMemoryCache } from '../src/feed/snapshot-cache.js';
import { buildTestApp } from './helpers/index.js';

describe('getFeedSkeleton auth handling', () => {
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;
  const originalPrivateMode = config.FEED_PRIVATE_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    config.FEED_PRIVATE_MODE = originalPrivateMode;
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
    verifyFeedRequesterDidMock.mockResolvedValue(null);
    isParticipantApprovedMock.mockResolvedValue(true);
  });

  afterEach(async () => {
    await drainFeedRequestTracker(1000);
    __resetFeedRequestTrackerForTests();
    clearCurrentFeedSnapshotMemoryCache();
    config.FEED_PRIVATE_MODE = originalPrivateMode;
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
    await drainFeedRequestTracker(1000);
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
    await drainFeedRequestTracker(1000);
    expect(verifyFeedRequesterDidMock).toHaveBeenCalledWith('Bearer malformed');

    await app.close();
  });

  it('reuses the private-mode verified DID for tracking instead of verifying twice', async () => {
    config.FEED_PRIVATE_MODE = true;
    verifyFeedRequesterDidMock.mockResolvedValue('did:plc:approved-viewer');
    isParticipantApprovedMock.mockResolvedValue(true);

    const app = buildTestApp();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer valid.jwt',
      },
    });

    expect(response.statusCode).toBe(200);
    await drainFeedRequestTracker(1000);

    expect(verifyFeedRequesterDidMock).toHaveBeenCalledTimes(1);
    expect(verifyFeedRequesterDidMock).toHaveBeenCalledWith('Bearer valid.jwt');
    expect(isParticipantApprovedMock).toHaveBeenCalledWith('did:plc:approved-viewer');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][1]).toEqual(['did:plc:approved-viewer']);

    await app.close();
  });

  it('does not serve an enabled private community to an anonymous caller', async () => {
    const birders = resolveFeedCommunityByRkey('birders-who-code', getFeedCommunities());
    if (!birders) {
      throw new Error('Birders community fixture missing from registry');
    }
    const privateBirders: FeedCommunity = {
      ...birders,
      status: 'enabled',
      public: false,
    };
    const app = buildTestApp();
    registerFeedSkeleton(app, { communities: [privateBirders] });

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUriForCommunity(privateBirders, config.FEEDGEN_PUBLISHER_DID))}&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feed: [] });
    expect(verifyFeedRequesterDidMock).toHaveBeenCalledWith(undefined);
    expect(redisMock.zrevrange).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not serve an enabled private community to an unapproved caller', async () => {
    const birders = resolveFeedCommunityByRkey('birders-who-code', getFeedCommunities());
    if (!birders) {
      throw new Error('Birders community fixture missing from registry');
    }
    const privateBirders: FeedCommunity = { ...birders, status: 'enabled', public: false };
    verifyFeedRequesterDidMock.mockResolvedValue('did:plc:unapproved');
    isParticipantApprovedMock.mockResolvedValue(false);
    const app = buildTestApp();
    registerFeedSkeleton(app, { communities: [privateBirders] });

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUriForCommunity(privateBirders, config.FEEDGEN_PUBLISHER_DID))}&limit=2`,
      headers: { authorization: 'Bearer valid.jwt' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feed: [] });
    expect(isParticipantApprovedMock).toHaveBeenCalledWith('did:plc:unapproved');
    expect(redisMock.zrevrange).not.toHaveBeenCalled();

    await app.close();
  });
});
