/**
 * Engagement Ingestion Filter Tests
 *
 * Verifies that likes and reposts are only stored when the referenced post
 * exists in the posts table. This prevents firehose engagement for untracked
 * posts from consuming disk space.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
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

import { handleLike } from '../src/ingestion/handlers/like-handler.js';
import { handleRepost } from '../src/ingestion/handlers/repost-handler.js';

describe('like handler post-existence filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts like and increments engagement when post exists', async () => {
    // First call: INSERT INTO likes (post exists, rowCount=1)
    // Second call: UPDATE post_engagement (engagement counter)
    // Third call: UPDATE engagement_attributions (fire-and-forget)
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ uri: 'at://did:plc:xyz/app.bsky.feed.like/1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleLike(
      'at://did:plc:xyz/app.bsky.feed.like/1',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    // Verify INSERT INTO likes was called with WHERE EXISTS
    const insertCall = dbQueryMock.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO likes');
    expect(insertCall[0]).toContain('WHERE EXISTS');
    expect(insertCall[0]).toContain('SELECT 1 FROM posts WHERE uri = $3');

    // Verify engagement counter was incremented
    const engagementCall = dbQueryMock.mock.calls[1];
    expect(engagementCall[0]).toContain('UPDATE post_engagement');
    expect(engagementCall[0]).toContain('like_count = like_count + 1');
  });

  it('skips engagement update when post does not exist', async () => {
    // INSERT returns rowCount=0 (WHERE EXISTS failed — post not in system)
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleLike(
      'at://did:plc:xyz/app.bsky.feed.like/2',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:unknown/app.bsky.feed.post/999', cid: 'cid456' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    // INSERT was attempted (SQL handles the filtering)
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain('INSERT INTO likes');

    // No engagement update — rowCount was 0
    const engagementCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE post_engagement')
    );
    expect(engagementCalls.length).toBe(0);
  });

  it('handles duplicate like gracefully (ON CONFLICT DO NOTHING)', async () => {
    // ON CONFLICT DO NOTHING returns rowCount=0
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleLike(
      'at://did:plc:xyz/app.bsky.feed.like/1',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    // Only the INSERT was called, no engagement update
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('skips likes missing subject URI', async () => {
    await handleLike(
      'at://did:plc:xyz/app.bsky.feed.like/3',
      'did:plc:xyz',
      { createdAt: '2025-01-01T00:00:00.000Z' }
    );

    // No DB calls at all — early return
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('does not rethrow on DB error', async () => {
    dbQueryMock.mockRejectedValueOnce(new Error('connection refused'));

    // Should not throw
    await expect(
      handleLike(
        'at://did:plc:xyz/app.bsky.feed.like/4',
        'did:plc:xyz',
        {
          subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
          createdAt: '2025-01-01T00:00:00.000Z',
        }
      )
    ).resolves.toBeUndefined();
  });
});

describe('repost handler post-existence filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts repost and increments engagement when post exists', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ uri: 'at://did:plc:xyz/app.bsky.feed.repost/1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleRepost(
      'at://did:plc:xyz/app.bsky.feed.repost/1',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    // Verify INSERT INTO reposts was called with WHERE EXISTS
    const insertCall = dbQueryMock.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO reposts');
    expect(insertCall[0]).toContain('WHERE EXISTS');
    expect(insertCall[0]).toContain('SELECT 1 FROM posts WHERE uri = $3');

    // Verify engagement counter was incremented
    const engagementCall = dbQueryMock.mock.calls[1];
    expect(engagementCall[0]).toContain('UPDATE post_engagement');
    expect(engagementCall[0]).toContain('repost_count = repost_count + 1');
  });

  it('skips engagement update when post does not exist', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleRepost(
      'at://did:plc:xyz/app.bsky.feed.repost/2',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:unknown/app.bsky.feed.post/999', cid: 'cid456' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    // INSERT was attempted
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain('INSERT INTO reposts');

    // No engagement update
    const engagementCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE post_engagement')
    );
    expect(engagementCalls.length).toBe(0);
  });

  it('handles duplicate repost gracefully', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleRepost(
      'at://did:plc:xyz/app.bsky.feed.repost/1',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('skips reposts missing subject URI', async () => {
    await handleRepost(
      'at://did:plc:xyz/app.bsky.feed.repost/3',
      'did:plc:xyz',
      { createdAt: '2025-01-01T00:00:00.000Z' }
    );

    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('does not rethrow on DB error', async () => {
    dbQueryMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(
      handleRepost(
        'at://did:plc:xyz/app.bsky.feed.repost/4',
        'did:plc:xyz',
        {
          subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
          createdAt: '2025-01-01T00:00:00.000Z',
        }
      )
    ).resolves.toBeUndefined();
  });
});
