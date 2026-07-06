/**
 * Tests for write-time engagement attribution.
 * Verifies that like/repost handlers fire attribution UPDATE queries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('engagement attribution - likes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires epoch-scoped attribution UPDATE after successful like insert', async () => {
    // First call: INSERT like outcome -> success (new tracked row)
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 });
    // Second call: UPDATE post_engagement
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // Third call: UPDATE engagement_attributions (fire-and-forget)
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleLike(
      'at://did:plc:liker/app.bsky.feed.like/1',
      'did:plc:liker',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    // Wait a tick for the fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 10));

    // Should have 3 db.query calls: INSERT like, UPDATE engagement, UPDATE attribution
    expect(dbQueryMock).toHaveBeenCalledTimes(3);

    const attributionCall = dbQueryMock.mock.calls[2];
    expect(attributionCall[0]).toContain('UPDATE engagement_attributions');
    expect(attributionCall[0]).toContain("engagement_type = 'like'");
    expect(attributionCall[0]).toContain('WITH active_epoch AS');
    expect(attributionCall[0]).toContain("WHERE status = 'active'");
    expect(attributionCall[0]).toContain('ea.epoch_id = active_epoch.id');
    expect(attributionCall[0]).toContain('engaged_at IS NULL');
    expect(attributionCall[1]).toEqual([
      'at://did:plc:author/app.bsky.feed.post/1',
      'did:plc:liker',
    ]);
  });

  it('does not fire attribution when like is duplicate', async () => {
    // INSERT like outcome -> tracked subject, duplicate like.
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleLike(
      'at://did:plc:liker/app.bsky.feed.like/1',
      'did:plc:liker',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    await new Promise((r) => setTimeout(r, 10));

    // Only the INSERT call, no engagement or attribution updates
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('attribution failure does not prevent like from being stored', async () => {
    // INSERT like outcome -> success
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 });
    // UPDATE post_engagement → success
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // UPDATE attribution → FAILS
    dbQueryMock.mockRejectedValueOnce(new Error('attribution table gone'));

    await handleLike(
      'at://did:plc:liker/app.bsky.feed.like/1',
      'did:plc:liker',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    await new Promise((r) => setTimeout(r, 10));

    // Like and engagement were still stored (first 2 calls succeeded)
    expect(dbQueryMock).toHaveBeenCalledTimes(3);
  });

  it('leaves attribution untouched when active epoch does not match', async () => {
    // INSERT like outcome -> success
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 });
    // UPDATE post_engagement → success
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // UPDATE attribution → no row updated (epoch mismatch)
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: true }], rowCount: 1 });

    await handleLike(
      'at://did:plc:liker/app.bsky.feed.like/1',
      'did:plc:liker',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(dbQueryMock).toHaveBeenCalledTimes(3);
    expect(dbQueryMock.mock.calls[2][0]).toContain('ea.epoch_id = active_epoch.id');
  });
});

describe('engagement attribution - reposts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires epoch-scoped attribution UPDATE after successful repost insert', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 });
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await handleRepost(
      'at://did:plc:reposter/app.bsky.feed.repost/1',
      'did:plc:reposter',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(dbQueryMock).toHaveBeenCalledTimes(3);

    const attributionCall = dbQueryMock.mock.calls[2];
    expect(attributionCall[0]).toContain('UPDATE engagement_attributions');
    expect(attributionCall[0]).toContain("engagement_type = 'repost'");
    expect(attributionCall[0]).toContain('WITH active_epoch AS');
    expect(attributionCall[0]).toContain("WHERE status = 'active'");
    expect(attributionCall[0]).toContain('ea.epoch_id = active_epoch.id');
    expect(attributionCall[1]).toEqual([
      'at://did:plc:author/app.bsky.feed.post/1',
      'did:plc:reposter',
    ]);
  });

  it('does not fire attribution when repost is duplicate', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: false, subjectExists: true }], rowCount: 1 });

    await handleRepost(
      'at://did:plc:reposter/app.bsky.feed.repost/1',
      'did:plc:reposter',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('attribution failure does not prevent repost from being stored', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 });
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    dbQueryMock.mockRejectedValueOnce(new Error('attribution table gone'));

    await handleRepost(
      'at://did:plc:reposter/app.bsky.feed.repost/1',
      'did:plc:reposter',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(dbQueryMock).toHaveBeenCalledTimes(3);
  });

  it('updates attribution when active epoch matches', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ inserted: true, subjectExists: true }], rowCount: 1 });
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await handleRepost(
      'at://did:plc:reposter/app.bsky.feed.repost/1',
      'did:plc:reposter',
      { subject: { uri: 'at://did:plc:author/app.bsky.feed.post/1' } }
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(dbQueryMock).toHaveBeenCalledTimes(3);
    expect(dbQueryMock.mock.calls[2][0]).toContain('ea.epoch_id = active_epoch.id');
  });
});
