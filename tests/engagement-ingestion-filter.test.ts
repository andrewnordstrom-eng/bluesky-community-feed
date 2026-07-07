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
    // First call: INSERT INTO likes (post exists, inserted=true)
    // Second call: UPDATE post_engagement (engagement counter)
    // Third call: UPDATE engagement_attributions (fire-and-forget)
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const outcome = await handleLike(
      'at://did:plc:xyz/app.bsky.feed.like/1',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );
    expect(outcome).toBe('like-inserted');

    // Verify INSERT INTO likes is gated by post existence in the same SQL statement.
    const insertCall = dbQueryMock.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO likes');
    expect(insertCall[0]).toContain('WITH subject AS');
    expect(insertCall[0]).toContain('FROM subject');
    expect(insertCall[0]).toContain('SELECT 1 FROM posts WHERE uri = $3 AND deleted = FALSE');

    // Verify engagement counter was incremented
    const engagementCall = dbQueryMock.mock.calls[1];
    expect(engagementCall[0]).toContain('UPDATE post_engagement');
    expect(engagementCall[0]).toContain('like_count = like_count + 1');
  });

  it('skips engagement update when post does not exist', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: false }], rowCount: 1 });

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

    // No engagement update — subject was not tracked
    const engagementCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE post_engagement')
    );
    expect(engagementCalls.length).toBe(0);
  });

  it('handles duplicate like gracefully (ON CONFLICT DO NOTHING)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: true }], rowCount: 1 });

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

  it('treats soft-deleted posts as untracked like subjects', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: false }], rowCount: 1 });

    const outcome = await handleLike(
      'at://did:plc:xyz/app.bsky.feed.like/deleted',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/deleted', cid: 'ciddeleted' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    expect(outcome).toBe('like-untracked-ignored');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain('deleted = FALSE');
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
    ).resolves.toBe('like-handler-error');
  });
});

describe('repost handler post-existence filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts repost and increments engagement when post exists', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const outcome = await handleRepost(
      'at://did:plc:xyz/app.bsky.feed.repost/1',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: 'cid123' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );
    expect(outcome).toBe('repost-inserted');

    // Verify INSERT INTO reposts is gated by post existence in the same SQL statement.
    const insertCall = dbQueryMock.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO reposts');
    expect(insertCall[0]).toContain('WITH subject AS');
    expect(insertCall[0]).toContain('FROM subject');
    expect(insertCall[0]).toContain('SELECT 1 FROM posts WHERE uri = $3 AND deleted = FALSE');

    // Verify engagement counter was incremented
    const engagementCall = dbQueryMock.mock.calls[1];
    expect(engagementCall[0]).toContain('UPDATE post_engagement');
    expect(engagementCall[0]).toContain('repost_count = repost_count + 1');
  });

  it('skips engagement update when post does not exist', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: false }], rowCount: 1 });

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
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: true }], rowCount: 1 });

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

  it('treats soft-deleted posts as untracked repost subjects', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: false }], rowCount: 1 });

    const outcome = await handleRepost(
      'at://did:plc:xyz/app.bsky.feed.repost/deleted',
      'did:plc:xyz',
      {
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/deleted', cid: 'ciddeleted' },
        createdAt: '2025-01-01T00:00:00.000Z',
      }
    );

    expect(outcome).toBe('repost-untracked-ignored');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain('deleted = FALSE');
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
    ).resolves.toBe('repost-handler-error');
  });
});
