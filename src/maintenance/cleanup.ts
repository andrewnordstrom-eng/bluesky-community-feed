/**
 * Post Retention Cleanup
 *
 * Runs every hour to hard-delete old posts that were never scored and
 * are not in the active feed. This reclaims disk space on the VPS.
 *
 * What gets deleted:
 * - Posts with indexed_at > 72 hours ago that have no post_scores rows
 *   and are not in the Redis feed:current sorted set
 * - Orphaned likes/reposts whose subject_uri no longer exists in posts
 *   (these have no FK, so CASCADE doesn't help)
 * - Likes/reposts older than 7 days for posts that are not scored
 * - Follows older than 7 days
 *
 * post_engagement and post_scores have ON DELETE CASCADE from posts,
 * so they are cleaned up automatically.
 *
 * VACUUM runs after large deletes to reclaim disk space.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';

export interface CleanupResult {
  postsDeleted: number;
  orphanedLikesDeleted: number;
  orphanedRepostsDeleted: number;
  staleLikesDeleted: number;
  staleRepostsDeleted: number;
  oldFollowsDeleted: number;
  vacuumRan: boolean;
  durationMs: number;
}

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const RETENTION_HOURS = 72;
const INTERACTION_RETENTION_DAYS = 7;
const BATCH_SIZE = 5000;
const VACUUM_THRESHOLD = 1000;

let isRunning = false;
let isCleaning = false;
let intervalId: NodeJS.Timeout | null = null;
let isShuttingDown = false;

/**
 * Start the cleanup scheduler.
 * Runs immediately, then every hour.
 */
export async function startCleanup(): Promise<void> {
  if (isRunning) {
    logger.warn('Cleanup scheduler already running');
    return;
  }

  isRunning = true;
  isShuttingDown = false;

  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS, retentionHours: RETENTION_HOURS },
    'Starting cleanup scheduler'
  );

  // Run immediately on start
  await runWithGuard();

  // Schedule recurring runs
  intervalId = setInterval(runWithGuard, CLEANUP_INTERVAL_MS);

  logger.info('Cleanup scheduler started');
}

/**
 * Stop the cleanup scheduler.
 * Waits for any in-progress cleanup to complete.
 */
export async function stopCleanup(): Promise<void> {
  if (!isRunning) {
    return;
  }

  logger.info('Stopping cleanup scheduler...');
  isShuttingDown = true;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  // Wait for in-progress cleanup to complete
  while (isCleaning) {
    logger.info('Waiting for cleanup run to complete...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  isRunning = false;
  logger.info('Cleanup scheduler stopped');
}

/**
 * Check if the cleanup scheduler is running.
 */
export function isCleanupRunning(): boolean {
  return isRunning;
}

/**
 * Manually trigger a cleanup run and return the result.
 */
export async function triggerManualCleanup(): Promise<CleanupResult | null> {
  if (isShuttingDown) {
    logger.warn('Manual cleanup rejected - scheduler is shutting down');
    return null;
  }

  if (isCleaning) {
    logger.warn('Manual cleanup rejected - cleanup already in progress');
    return null;
  }

  logger.info('Manual cleanup triggered');
  return runCleanupInternal();
}

async function runWithGuard(): Promise<void> {
  if (isShuttingDown) return;

  if (isCleaning) {
    logger.warn('Skipping cleanup run - previous run still in progress');
    return;
  }

  isCleaning = true;
  try {
    await runCleanupInternal();
  } catch (err) {
    logger.error({ err }, 'Cleanup run failed');
  } finally {
    isCleaning = false;
  }
}

async function runCleanupInternal(): Promise<CleanupResult> {
  const startTime = Date.now();
  logger.info('Starting cleanup run');

  // 1. Get protected post URIs from the active feed
  let feedUris: string[] = [];
  try {
    feedUris = await redis.zrange('feed:current', 0, -1);
  } catch (err) {
    logger.warn({ err }, 'Failed to read feed:current from Redis, proceeding with empty protection list');
  }

  // 2. Batch-delete old unscored posts
  let postsDeleted = 0;
  try {
    postsDeleted = await batchDeleteOldPosts(feedUris);
  } catch (err) {
    logger.error({ err }, 'Failed to delete old posts');
  }

  // 3. Delete orphaned likes and reposts (no FK to posts)
  let orphanedLikesDeleted = 0;
  try {
    orphanedLikesDeleted = await batchDeleteOrphanedLikes();
  } catch (err) {
    logger.error({ err }, 'Failed to delete orphaned likes');
  }

  let orphanedRepostsDeleted = 0;
  try {
    orphanedRepostsDeleted = await batchDeleteOrphanedReposts();
  } catch (err) {
    logger.error({ err }, 'Failed to delete orphaned reposts');
  }

  // 4. Delete old likes/reposts not associated with scored posts, and old follows.
  let staleLikesDeleted = 0;
  try {
    staleLikesDeleted = await batchDeleteStaleLikes();
  } catch (err) {
    logger.error({ err }, 'Failed to delete stale likes');
  }

  let staleRepostsDeleted = 0;
  try {
    staleRepostsDeleted = await batchDeleteStaleReposts();
  } catch (err) {
    logger.error({ err }, 'Failed to delete stale reposts');
  }

  let oldFollowsDeleted = 0;
  try {
    oldFollowsDeleted = await batchDeleteOldFollows();
  } catch (err) {
    logger.error({ err }, 'Failed to delete old follows');
  }

  const totalDeleted =
    postsDeleted +
    orphanedLikesDeleted +
    orphanedRepostsDeleted +
    staleLikesDeleted +
    staleRepostsDeleted +
    oldFollowsDeleted;

  // 5. VACUUM if we deleted enough rows to matter
  let vacuumRan = false;
  if (totalDeleted > VACUUM_THRESHOLD) {
    vacuumRan = await runVacuum();
  }

  const result: CleanupResult = {
    postsDeleted,
    orphanedLikesDeleted,
    orphanedRepostsDeleted,
    staleLikesDeleted,
    staleRepostsDeleted,
    oldFollowsDeleted,
    vacuumRan,
    durationMs: Date.now() - startTime,
  };

  logger.info(result, 'Cleanup run complete');

  // 6. Store result for admin dashboard visibility
  try {
    await db.query(
      `INSERT INTO system_status (key, value, updated_at)
       VALUES ('last_cleanup_run', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(result)]
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to store cleanup result in system_status');
  }

  return result;
}

async function batchDeleteOldPosts(feedUris: string[]): Promise<number> {
  let totalDeleted = 0;
  const client = await db.connect();

  try {
    await client.query("SET statement_timeout = '120s'");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isShuttingDown) break;

      const result = await client.query(
        `DELETE FROM posts
         WHERE uri IN (
           SELECT p.uri FROM posts p
           WHERE p.indexed_at < NOW() - INTERVAL '${RETENTION_HOURS} hours'
             AND NOT EXISTS (SELECT 1 FROM post_scores ps WHERE ps.post_uri = p.uri)
             AND p.uri != ALL($1::text[])
           LIMIT $2
         )`,
        [feedUris, BATCH_SIZE]
      );

      const deleted = result.rowCount ?? 0;
      totalDeleted += deleted;

      if (deleted > 0) {
        logger.debug({ deleted, totalDeleted }, 'Cleanup batch: posts deleted');
      }

      if (deleted < BATCH_SIZE) break;
    }
  } finally {
    await client.query("SET statement_timeout = '10s'").catch(() => {});
    client.release();
  }

  return totalDeleted;
}

async function batchDeleteOrphanedLikes(): Promise<number> {
  let totalDeleted = 0;
  const client = await db.connect();

  try {
    await client.query("SET statement_timeout = '120s'");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isShuttingDown) break;

      const result = await client.query(
        `DELETE FROM likes
         WHERE uri IN (
           SELECT l.uri FROM likes l
           WHERE l.created_at < NOW() - INTERVAL '${RETENTION_HOURS} hours'
             AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.uri = l.subject_uri)
           LIMIT $1
         )`,
        [BATCH_SIZE]
      );

      const deleted = result.rowCount ?? 0;
      totalDeleted += deleted;

      if (deleted > 0) {
        logger.debug({ deleted, totalDeleted }, 'Cleanup batch: orphaned likes deleted');
      }

      if (deleted < BATCH_SIZE) break;
    }
  } finally {
    await client.query("SET statement_timeout = '10s'").catch(() => {});
    client.release();
  }

  return totalDeleted;
}

async function batchDeleteOrphanedReposts(): Promise<number> {
  let totalDeleted = 0;
  const client = await db.connect();

  try {
    await client.query("SET statement_timeout = '120s'");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isShuttingDown) break;

      const result = await client.query(
        `DELETE FROM reposts
         WHERE uri IN (
           SELECT r.uri FROM reposts r
           WHERE r.created_at < NOW() - INTERVAL '${RETENTION_HOURS} hours'
             AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.uri = r.subject_uri)
           LIMIT $1
         )`,
        [BATCH_SIZE]
      );

      const deleted = result.rowCount ?? 0;
      totalDeleted += deleted;

      if (deleted > 0) {
        logger.debug({ deleted, totalDeleted }, 'Cleanup batch: orphaned reposts deleted');
      }

      if (deleted < BATCH_SIZE) break;
    }
  } finally {
    await client.query("SET statement_timeout = '10s'").catch(() => {});
    client.release();
  }

  return totalDeleted;
}

async function batchDeleteStaleLikes(): Promise<number> {
  let totalDeleted = 0;
  const client = await db.connect();

  try {
    await client.query("SET statement_timeout = '120s'");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isShuttingDown) break;

      const result = await client.query(
        `DELETE FROM likes
         WHERE uri IN (
           SELECT l.uri FROM likes l
           WHERE l.created_at < NOW() - INTERVAL '${INTERACTION_RETENTION_DAYS} days'
             AND NOT EXISTS (SELECT 1 FROM post_scores ps WHERE ps.post_uri = l.subject_uri)
           LIMIT $1
         )`,
        [BATCH_SIZE]
      );

      const deleted = result.rowCount ?? 0;
      totalDeleted += deleted;

      if (deleted > 0) {
        logger.debug({ deleted, totalDeleted }, 'Cleanup batch: stale likes deleted');
      }

      if (deleted < BATCH_SIZE) break;
    }
  } finally {
    await client.query("SET statement_timeout = '10s'").catch(() => {});
    client.release();
  }

  return totalDeleted;
}

async function batchDeleteStaleReposts(): Promise<number> {
  let totalDeleted = 0;
  const client = await db.connect();

  try {
    await client.query("SET statement_timeout = '120s'");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isShuttingDown) break;

      const result = await client.query(
        `DELETE FROM reposts
         WHERE uri IN (
           SELECT r.uri FROM reposts r
           WHERE r.created_at < NOW() - INTERVAL '${INTERACTION_RETENTION_DAYS} days'
             AND NOT EXISTS (SELECT 1 FROM post_scores ps WHERE ps.post_uri = r.subject_uri)
           LIMIT $1
         )`,
        [BATCH_SIZE]
      );

      const deleted = result.rowCount ?? 0;
      totalDeleted += deleted;

      if (deleted > 0) {
        logger.debug({ deleted, totalDeleted }, 'Cleanup batch: stale reposts deleted');
      }

      if (deleted < BATCH_SIZE) break;
    }
  } finally {
    await client.query("SET statement_timeout = '10s'").catch(() => {});
    client.release();
  }

  return totalDeleted;
}

async function batchDeleteOldFollows(): Promise<number> {
  let totalDeleted = 0;
  const client = await db.connect();

  try {
    await client.query("SET statement_timeout = '120s'");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isShuttingDown) break;

      const result = await client.query(
        `DELETE FROM follows
         WHERE uri IN (
           SELECT f.uri FROM follows f
           WHERE f.created_at < NOW() - INTERVAL '${INTERACTION_RETENTION_DAYS} days'
           LIMIT $1
         )`,
        [BATCH_SIZE]
      );

      const deleted = result.rowCount ?? 0;
      totalDeleted += deleted;

      if (deleted > 0) {
        logger.debug({ deleted, totalDeleted }, 'Cleanup batch: old follows deleted');
      }

      if (deleted < BATCH_SIZE) break;
    }
  } finally {
    await client.query("SET statement_timeout = '10s'").catch(() => {});
    client.release();
  }

  return totalDeleted;
}

async function runVacuum(): Promise<boolean> {
  let client;
  try {
    client = await db.connect();
    await client.query("SET statement_timeout = '300s'");

    logger.info('Running VACUUM ANALYZE on posts, likes, reposts, follows');
    await client.query('VACUUM (ANALYZE) posts');
    await client.query('VACUUM (ANALYZE) likes');
    await client.query('VACUUM (ANALYZE) reposts');
    await client.query('VACUUM (ANALYZE) follows');

    logger.info('VACUUM complete');
    return true;
  } catch (err) {
    logger.warn({ err }, 'VACUUM failed (non-fatal, autovacuum will handle it)');
    return false;
  } finally {
    if (client) {
      await client.query("SET statement_timeout = '10s'").catch(() => {});
      client.release();
    }
  }
}
