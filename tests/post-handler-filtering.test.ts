import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { dbQueryMock, redisGetMock, redisSetMock, redisDelMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
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

import { handlePost } from '../src/ingestion/handlers/post-handler.js';
import { handleLike } from '../src/ingestion/handlers/like-handler.js';

describe('post handler content filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all DB operations succeed
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    redisSetMock.mockResolvedValue('OK');
  });

  it('skips non-matching posts when include keywords are active', async () => {
    // Content rules cached in Redis
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        includeKeywords: ['bluesky', 'atproto'],
        excludeKeywords: [],
      })
    );

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/1',
      'did:plc:abc',
      'cid123',
      { text: 'I had a great lunch today', createdAt: new Date().toISOString() }
    );

    // Should NOT have called INSERT (post was filtered out)
    const insertCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
    );
    expect(insertCalls.length).toBe(0);
  });

  it('inserts posts matching include keywords', async () => {
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        includeKeywords: ['bluesky', 'atproto'],
        excludeKeywords: [],
      })
    );

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/2',
      'did:plc:abc',
      'cid456',
      { text: 'Building on atproto is awesome', createdAt: new Date().toISOString() }
    );

    // Should have called INSERT
    const insertCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
    );
    expect(insertCalls.length).toBe(1);
  });

  it('inserts all posts when no content rules exist', async () => {
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        includeKeywords: [],
        excludeKeywords: [],
      })
    );

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/3',
      'did:plc:abc',
      'cid789',
      { text: 'Completely random post', createdAt: new Date().toISOString() }
    );

    // Should have called INSERT (no filtering when rules are empty)
    const insertCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
    );
    expect(insertCalls.length).toBe(1);
  });

  it('inserts posts when content filter fails (fail-open)', async () => {
    // Redis fails, DB falls back and also fails
    redisGetMock.mockRejectedValue(new Error('redis connection refused'));
    // DB query for content rules also fails (all queries are mocked together)
    // The first call will be the content rules DB fallback, which should fail
    // Then the post INSERT should still succeed
    let callCount = 0;
    dbQueryMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Content rules DB fallback — fails
        throw new Error('db connection refused');
      }
      // Subsequent calls (INSERT) succeed
      return { rows: [], rowCount: 1 };
    });

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/4',
      'did:plc:abc',
      'cidabc',
      { text: 'Post during outage', createdAt: new Date().toISOString() }
    );

    // Should have called INSERT despite filter failure (fail-open)
    const insertCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
    );
    expect(insertCalls.length).toBe(1);
  });

  it('filters out posts matching exclude keywords', async () => {
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        includeKeywords: [],
        excludeKeywords: ['spam', 'scam'],
      })
    );

    await handlePost(
      'at://did:plc:abc/app.bsky.feed.post/5',
      'did:plc:abc',
      'ciddef',
      { text: 'This is spam content for sale', createdAt: new Date().toISOString() }
    );

    // Should NOT have called INSERT (excluded)
    const insertCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO posts')
    );
    expect(insertCalls.length).toBe(0);
  });
});

describe('like handler is not affected by content keyword filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('attempts like insert regardless of content filter keywords', async () => {
    // Content keyword filters (include/exclude) only affect posts, not likes.
    // Likes are filtered at the SQL level by post existence (WHERE EXISTS).
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        includeKeywords: ['bluesky'],
        excludeKeywords: ['spam'],
      })
    );

    await handleLike(
      'at://did:plc:xyz/app.bsky.feed.like/1',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
        createdAt: new Date().toISOString(),
      }
    );

    // Should have called INSERT INTO likes (SQL-level WHERE EXISTS handles filtering)
    const likeCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO likes')
    );
    expect(likeCalls.length).toBe(1);
  });
});
