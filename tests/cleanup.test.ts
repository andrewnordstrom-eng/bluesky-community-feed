import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const {
  dbQueryMock,
  dbConnectMock,
  clientQueryMock,
  clientReleaseMock,
  redisZrangeMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  dbConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  redisZrangeMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    zrange: redisZrangeMock,
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

import { triggerManualCleanup } from '../src/maintenance/cleanup.js';

describe('cleanup job', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: db.connect() returns a mock client
    dbConnectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock,
    });

    // Default: empty feed
    redisZrangeMock.mockResolvedValue([]);

    // Default: system_status write succeeds
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('deletes old unscored posts and preserves scored ones', async () => {
    // First batch: 95 posts deleted (simulating 100 total, 5 scored)
    // Second batch: 0 (done)
    let postDeleteCallCount = 0;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postDeleteCallCount++;
        if (postDeleteCallCount === 1) {
          return { rowCount: 95, rows: Array(95).fill({}) };
        }
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(95);
    expect(result!.orphanedLikesDeleted).toBe(0);
    expect(result!.orphanedRepostsDeleted).toBe(0);
    expect(result!.staleLikesDeleted).toBe(0);
    expect(result!.staleRepostsDeleted).toBe(0);
    expect(result!.oldFollowsDeleted).toBe(0);

    // Verify the DELETE query includes NOT EXISTS (post_scores)
    const deleteCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DELETE FROM posts')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0]).toContain('NOT EXISTS');
    expect(deleteCall![0]).toContain('post_scores');
  });

  it('protects posts in Redis feed snapshot', async () => {
    const feedUris = ['at://did:plc:abc/app.bsky.feed.post/feed1', 'at://did:plc:abc/app.bsky.feed.post/feed2'];
    redisZrangeMock.mockResolvedValue(feedUris);

    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });

    await triggerManualCleanup();

    // Verify feed URIs were passed as the exclusion parameter
    const deleteCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DELETE FROM posts')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual(expect.arrayContaining([feedUris, expect.any(Number)]));
  });

  it('cleans orphaned likes and reposts', async () => {
    let postBatch = 0;
    let orphanLikeBatch = 0;
    let orphanRepostBatch = 0;

    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postBatch++;
        if (postBatch === 1) return { rowCount: 50, rows: Array(50).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes') && sql.includes('FROM posts p')) {
        orphanLikeBatch++;
        if (orphanLikeBatch === 1) return { rowCount: 12, rows: Array(12).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes') && sql.includes('post_scores')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts') && sql.includes('FROM posts p')) {
        orphanRepostBatch++;
        if (orphanRepostBatch === 1) return { rowCount: 5, rows: Array(5).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts') && sql.includes('post_scores')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM follows')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(50);
    expect(result!.orphanedLikesDeleted).toBe(12);
    expect(result!.orphanedRepostsDeleted).toBe(5);
    expect(result!.orphanedEngagementDeleted).toBe(0);
    expect(result!.staleLikesDeleted).toBe(0);
    expect(result!.staleRepostsDeleted).toBe(0);
    expect(result!.oldFollowsDeleted).toBe(0);
  });

  // PROJ-917: post_engagement.post_uri lost its ON DELETE CASCADE FK to posts
  // when posts was partitioned (a partitioned table's unique constraints must
  // include the full partition key, so posts(uri) alone can no longer back
  // an FK — see migration 027 and this file's header comment). This sweep
  // mirrors the existing orphaned-likes/orphaned-reposts pattern above.
  it('cleans orphaned post_engagement rows (no more FK CASCADE from posts)', async () => {
    let orphanEngagementBatch = 0;

    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM follows')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM post_engagement')) {
        orphanEngagementBatch++;
        if (orphanEngagementBatch === 1) return { rowCount: 9, rows: Array(9).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.orphanedEngagementDeleted).toBe(9);

    const engagementCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' && (call[0] as string).includes('DELETE FROM post_engagement')
    );
    expect(engagementCall).toBeDefined();
    expect(engagementCall![0]).toContain('NOT EXISTS');
    expect(engagementCall![0]).toContain('FROM posts p');
  });

  // Thread 18: only the single-batch happy path was covered above. A batch
  // returning exactly BATCH_SIZE (5000) rows must not be treated as "done" --
  // the loop should keep going until a batch comes back smaller than
  // BATCH_SIZE, and the total must sum correctly across iterations.
  it('continues the orphaned post_engagement sweep across multiple batches', async () => {
    let orphanEngagementBatch = 0;

    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM follows')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM post_engagement')) {
        orphanEngagementBatch++;
        // First batch is a full BATCH_SIZE (5000) page -- the loop must not
        // stop here. Second batch is a smaller, final page.
        if (orphanEngagementBatch === 1) return { rowCount: 5000, rows: Array(5000).fill({}) };
        if (orphanEngagementBatch === 2) return { rowCount: 137, rows: Array(137).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.orphanedEngagementDeleted).toBe(5137);
    // Full BATCH_SIZE batch, then a smaller batch that ends the loop
    // (deleted < BATCH_SIZE) -- no third round-trip needed.
    expect(orphanEngagementBatch).toBe(2);
  });

  // Thread 18: a failure specific to the post_engagement DELETE must not take
  // down the rest of the cleanup run -- triggerManualCleanup's own try/catch
  // around batchDeleteOrphanedEngagement() should leave
  // orphanedEngagementDeleted at 0 and still return a result.
  it('completes the cleanup run with orphanedEngagementDeleted: 0 when the post_engagement DELETE rejects', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM post_engagement')) {
        throw new Error('simulated post_engagement DELETE failure');
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.orphanedEngagementDeleted).toBe(0);
    // The rest of the job still ran and produced a well-formed result.
    expect(result!.postsDeleted).toBe(0);
    expect(result!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('runs VACUUM only when threshold exceeded', async () => {
    // Delete 1500 posts (above VACUUM_THRESHOLD of 1000)
    let postBatch = 0;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postBatch++;
        if (postBatch === 1) return { rowCount: 1500, rows: Array(1500).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM follows')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('VACUUM')) {
        return { rows: [], rowCount: 0 };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.vacuumRan).toBe(true);

    // Verify VACUUM was called
    const vacuumCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('VACUUM')
    );
    expect(vacuumCalls.length).toBeGreaterThan(0);
  });

  it('skips VACUUM when below threshold', async () => {
    // Delete only 50 posts (below VACUUM_THRESHOLD)
    let postBatch = 0;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postBatch++;
        if (postBatch === 1) return { rowCount: 50, rows: Array(50).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM follows')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.vacuumRan).toBe(false);

    // Verify VACUUM was NOT called
    const vacuumCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('VACUUM')
    );
    expect(vacuumCalls.length).toBe(0);
  });

  it('handles empty feed:current gracefully', async () => {
    redisZrangeMock.mockResolvedValue([]);
    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(0);

    // Verify cleanup still ran (zrange was called)
    expect(redisZrangeMock).toHaveBeenCalledWith('feed:current', 0, -1);
  });

  it('handles Redis feed:current failure gracefully', async () => {
    redisZrangeMock.mockRejectedValue(new Error('redis connection failed'));
    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });

    const result = await triggerManualCleanup();

    // Should still complete (with empty protection list)
    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(0);
  });

  it('releases client connections even on error', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        throw new Error('query failed');
      }
      return { rowCount: 0, rows: [] };
    });

    // Should not throw (errors are caught internally)
    const result = await triggerManualCleanup();

    // Client should be released despite the error
    expect(clientReleaseMock).toHaveBeenCalled();

    // Result should still be returned (with 0 deletes since the error happened)
    expect(result).not.toBeNull();
  });

  it('deletes stale non-scored likes/reposts and old follows', async () => {
    let staleLikeBatch = 0;
    let staleRepostBatch = 0;
    let followsBatch = 0;

    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes') && sql.includes('FROM posts p')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts') && sql.includes('FROM posts p')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes') && sql.includes('post_scores')) {
        staleLikeBatch++;
        if (staleLikeBatch === 1) return { rowCount: 8, rows: Array(8).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts') && sql.includes('post_scores')) {
        staleRepostBatch++;
        if (staleRepostBatch === 1) return { rowCount: 4, rows: Array(4).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM follows')) {
        followsBatch++;
        if (followsBatch === 1) return { rowCount: 6, rows: Array(6).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.staleLikesDeleted).toBe(8);
    expect(result!.staleRepostsDeleted).toBe(4);
    expect(result!.oldFollowsDeleted).toBe(6);

    const staleLikeCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('DELETE FROM likes') &&
        (call[0] as string).includes('post_scores')
    );
    expect(staleLikeCall).toBeDefined();
    expect(staleLikeCall![0]).toContain("($1::int * INTERVAL '1 day')");
    expect(staleLikeCall![0]).toContain('NOT EXISTS (SELECT 1 FROM post_scores');

    const staleRepostCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('DELETE FROM reposts') &&
        (call[0] as string).includes('post_scores')
    );
    expect(staleRepostCall).toBeDefined();
    expect(staleRepostCall![0]).toContain("($1::int * INTERVAL '1 day')");

    const followsCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('DELETE FROM follows')
    );
    expect(followsCall).toBeDefined();
    expect(followsCall![0]).toContain("($1::int * INTERVAL '1 day')");
  });
});
