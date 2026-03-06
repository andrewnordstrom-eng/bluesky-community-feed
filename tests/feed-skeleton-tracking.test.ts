import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';
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
    setex: vi.fn(),
    get: vi.fn(),
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
    redisMock.setex.mockResolvedValue('OK');
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

    await new Promise((resolve) => setTimeout(resolve, 20));

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

    await new Promise((resolve) => setTimeout(resolve, 20));

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

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(dbQueryMock).not.toHaveBeenCalled();
    const [, rawLogEntry] = pipelineRpushMock.mock.calls.at(-1) as [string, string];
    const logEntry = JSON.parse(rawLogEntry);
    expect(logEntry.viewer_did).toBeNull();

    await app.close();
  });
});
