import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { dbQueryMock, redisGetMock, redisSetMock, redisDelMock, mockConfig } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
  mockConfig: {
    FILTER_NSFW_LABELS: true,
  },
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
    del: redisDelMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/config.js', () => ({
  config: mockConfig,
}));

import { handlePost } from '../src/ingestion/handlers/post-handler.js';

/** Helper to count INSERT INTO posts calls. */
function countPostInserts(): number {
  return dbQueryMock.mock.calls.filter(
    (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
  ).length;
}

describe('post handler AT Protocol NSFW label filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all DB operations succeed, no content rules
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    redisGetMock.mockResolvedValue(
      JSON.stringify({ includeKeywords: [], excludeKeywords: [] })
    );
    redisSetMock.mockResolvedValue('OK');
    // Reset config to default (enabled)
    mockConfig.FILTER_NSFW_LABELS = true;
  });

  it('filters posts with porn content label', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/1',
      'did:plc:abc',
      'cid1',
      {
        text: 'Some post',
        createdAt: new Date().toISOString(),
        labels: { values: [{ val: 'porn' }] },
      }
    );

    expect(countPostInserts()).toBe(0);
  });

  it('filters posts with nudity content label', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/2',
      'did:plc:abc',
      'cid2',
      {
        text: 'Another post',
        createdAt: new Date().toISOString(),
        labels: { values: [{ val: 'nudity' }] },
      }
    );

    expect(countPostInserts()).toBe(0);
  });

  it('allows posts with non-NSFW custom labels', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/3',
      'did:plc:abc',
      'cid3',
      {
        text: 'Post about spiders',
        createdAt: new Date().toISOString(),
        labels: { values: [{ val: 'spider' }] },
      }
    );

    expect(countPostInserts()).toBe(1);
  });

  it('allows posts with no labels field', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/4',
      'did:plc:abc',
      'cid4',
      {
        text: 'Normal post without labels',
        createdAt: new Date().toISOString(),
      }
    );

    expect(countPostInserts()).toBe(1);
  });

  it('allows posts with empty labels array', async () => {
    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/5',
      'did:plc:abc',
      'cid5',
      {
        text: 'Post with empty labels',
        createdAt: new Date().toISOString(),
        labels: { values: [] },
      }
    );

    expect(countPostInserts()).toBe(1);
  });

  it('allows NSFW-labeled posts when FILTER_NSFW_LABELS is disabled', async () => {
    mockConfig.FILTER_NSFW_LABELS = false;

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/6',
      'did:plc:abc',
      'cid6',
      {
        text: 'Labeled post',
        createdAt: new Date().toISOString(),
        labels: { values: [{ val: 'porn' }] },
      }
    );

    expect(countPostInserts()).toBe(1);
  });
});
