/**
 * Interaction Aggregator — Background Jobs
 *
 * Three jobs running on a single hourly interval:
 *
 * 1. Daily stats rollup: Aggregates feed_requests into feed_request_daily_stats
 *    for completed days (yesterday and earlier).
 *
 * 2. Epoch engagement stats: Computes engagement rate, scroll depth, viewer
 *    count for the current epoch from raw data. UPSERTs epoch_engagement_stats.
 *
 * 3. Retention cleanup: Deletes feed_requests and engagement_attributions
 *    older than 30 days. Runs once daily.
 *
 * Follows the same start/stop/guard pattern as cleanup.ts.
 */

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

const AGGREGATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const RETENTION_DAYS = 30;

let isRunning = false;
let isAggregating = false;
let intervalId: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let lastRetentionDate: string | null = null; // Track daily cleanup

/**
 * Start the interaction aggregator.
 * Runs immediately, then every hour.
 */
export async function startInteractionAggregator(): Promise<void> {
  if (isRunning) {
    logger.warn('Interaction aggregator already running');
    return;
  }

  isRunning = true;
  isShuttingDown = false;

  logger.info(
    { intervalMs: AGGREGATION_INTERVAL_MS, retentionDays: RETENTION_DAYS },
    'Starting interaction aggregator'
  );

  // Run immediately on start
  await runWithGuard();

  // Schedule recurring runs
  intervalId = setInterval(runWithGuard, AGGREGATION_INTERVAL_MS);

  logger.info('Interaction aggregator started');
}

/**
 * Stop the interaction aggregator.
 */
export async function stopInteractionAggregator(): Promise<void> {
  if (!isRunning) {
    return;
  }

  logger.info('Stopping interaction aggregator...');
  isShuttingDown = true;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  // Wait for in-progress aggregation to complete
  while (isAggregating) {
    logger.info('Waiting for aggregation run to complete...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  isRunning = false;
  logger.info('Interaction aggregator stopped');
}

export function isInteractionAggregatorRunning(): boolean {
  return isRunning;
}

async function runWithGuard(): Promise<void> {
  if (isShuttingDown) return;

  if (isAggregating) {
    logger.debug('Skipping aggregation tick - previous run still in progress');
    return;
  }

  isAggregating = true;
  try {
    await runAllJobs();
  } catch (err) {
    logger.error({ err }, 'Interaction aggregation failed');
  } finally {
    isAggregating = false;
  }
}

async function runAllJobs(): Promise<void> {
  const startTime = Date.now();

  // Job 1: Daily stats rollup
  await rollupDailyStats();

  // Job 2: Epoch engagement stats
  await computeEpochStats();

  // Job 2.5: Engagement trend alerting
  await checkEngagementTrends();

  // Job 3: Retention cleanup (once per day)
  const today = new Date().toISOString().split('T')[0];
  if (lastRetentionDate !== today) {
    await retentionCleanup();
    lastRetentionDate = today;
  }

  logger.info({ durationMs: Date.now() - startTime }, 'Interaction aggregation complete');
}

// ── Job 1: Daily Stats Rollup ───────────────────────────────────

async function rollupDailyStats(): Promise<void> {
  try {
    const result = await db.query(
      `WITH base_stats AS (
        SELECT
          fr.requested_at::date AS date,
          fr.epoch_id,
          COUNT(DISTINCT fr.viewer_did) FILTER (WHERE fr.viewer_did IS NOT NULL) AS unique_viewers,
          COUNT(*) FILTER (WHERE fr.viewer_did IS NULL) AS anonymous_requests,
          COUNT(*) AS total_requests,
          COUNT(*) AS total_pages,
          MAX(fr.page_offset + fr.posts_served) AS max_scroll_depth
        FROM feed_requests fr
        WHERE fr.requested_at::date < CURRENT_DATE
        GROUP BY fr.requested_at::date, fr.epoch_id
      ),
      session_pages AS (
        SELECT
          fr.requested_at::date AS date,
          fr.epoch_id,
          AVG(cnt)::float AS avg_pages_per_session
        FROM (
          SELECT requested_at::date AS requested_at, epoch_id, snapshot_id, COUNT(*) AS cnt
          FROM feed_requests
          WHERE requested_at::date < CURRENT_DATE
          GROUP BY requested_at::date, epoch_id, snapshot_id
        ) fr
        GROUP BY fr.requested_at, fr.epoch_id
      ),
      returning_viewers_cte AS (
        SELECT
          fr.requested_at::date AS date,
          fr.epoch_id,
          COUNT(DISTINCT fr.viewer_did) AS returning_viewers
        FROM feed_requests fr
        WHERE fr.requested_at::date < CURRENT_DATE
          AND fr.viewer_did IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM feed_requests fr2
            WHERE fr2.viewer_did = fr.viewer_did
              AND fr2.requested_at::date < fr.requested_at::date
          )
        GROUP BY fr.requested_at::date, fr.epoch_id
      )
      INSERT INTO feed_request_daily_stats (
        date, epoch_id, unique_viewers, anonymous_requests,
        total_requests, total_pages, avg_pages_per_session,
        max_scroll_depth, returning_viewers
      )
      SELECT
        bs.date,
        bs.epoch_id,
        bs.unique_viewers,
        bs.anonymous_requests,
        bs.total_requests,
        bs.total_pages,
        COALESCE(sp.avg_pages_per_session, 0),
        bs.max_scroll_depth,
        COALESCE(rv.returning_viewers, 0)
      FROM base_stats bs
      LEFT JOIN session_pages sp ON sp.date = bs.date AND sp.epoch_id = bs.epoch_id
      LEFT JOIN returning_viewers_cte rv ON rv.date = bs.date AND rv.epoch_id = bs.epoch_id
      ON CONFLICT (date, epoch_id) DO UPDATE SET
        unique_viewers = EXCLUDED.unique_viewers,
        anonymous_requests = EXCLUDED.anonymous_requests,
        total_requests = EXCLUDED.total_requests,
        total_pages = EXCLUDED.total_pages,
        avg_pages_per_session = EXCLUDED.avg_pages_per_session,
        max_scroll_depth = EXCLUDED.max_scroll_depth,
        returning_viewers = EXCLUDED.returning_viewers`
    );

    const rowCount = result.rowCount ?? 0;
    if (rowCount > 0) {
      logger.info({ rowsUpserted: rowCount }, 'Daily stats rollup complete');
    }
  } catch (err) {
    logger.error({ err }, 'Daily stats rollup failed');
  }
}

// ── Job 2: Epoch Engagement Stats ───────────────────────────────

async function computeEpochStats(): Promise<void> {
  try {
    // Get current epoch
    const epochResult = await db.query(
      `SELECT id FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
    );

    if (epochResult.rows.length === 0) {
      logger.debug('No active epoch found, skipping epoch stats');
      return;
    }

    const epochId = epochResult.rows[0].id;

    // Compute stats from raw data
    const statsResult = await db.query(
      `SELECT
        COUNT(*) AS total_feed_loads,
        COUNT(DISTINCT viewer_did) FILTER (WHERE viewer_did IS NOT NULL) AS unique_viewers,
        AVG(page_offset + posts_served)::float AS avg_scroll_depth,
        -- Returning viewer percentage
        CASE
          WHEN COUNT(DISTINCT viewer_did) FILTER (WHERE viewer_did IS NOT NULL) = 0 THEN 0
          ELSE (
            SELECT COUNT(DISTINCT fr2.viewer_did)::float /
              NULLIF(COUNT(DISTINCT fr.viewer_did) FILTER (WHERE fr.viewer_did IS NOT NULL), 0) * 100
            FROM feed_requests fr2
            WHERE fr2.epoch_id = $1
              AND fr2.viewer_did IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM feed_requests fr3
                WHERE fr3.viewer_did = fr2.viewer_did
                  AND fr3.requested_at::date < fr2.requested_at::date
              )
          )
        END AS returning_viewer_pct,
        -- Total posts served (sum of posts_served across all requests)
        SUM(posts_served) AS posts_served
      FROM feed_requests fr
      WHERE fr.epoch_id = $1`,
      [epochId]
    );

    // Compute engagement stats
    const engagementResult = await db.query(
      `SELECT
        COUNT(*) AS total_attributions,
        COUNT(*) FILTER (WHERE engaged_at IS NOT NULL) AS engaged,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE COUNT(*) FILTER (WHERE engaged_at IS NOT NULL)::float / COUNT(*)
        END AS engagement_rate,
        AVG(position_in_feed) FILTER (WHERE engaged_at IS NOT NULL)::float AS avg_engagement_position
      FROM engagement_attributions
      WHERE epoch_id = $1`,
      [epochId]
    );

    const stats = statsResult.rows[0];
    const engagement = engagementResult.rows[0];

    await db.query(
      `INSERT INTO epoch_engagement_stats (
        epoch_id, total_feed_loads, unique_viewers, avg_scroll_depth,
        returning_viewer_pct, posts_served, posts_with_engagement,
        engagement_rate, avg_engagement_position
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (epoch_id) DO UPDATE SET
        computed_at = NOW(),
        total_feed_loads = EXCLUDED.total_feed_loads,
        unique_viewers = EXCLUDED.unique_viewers,
        avg_scroll_depth = EXCLUDED.avg_scroll_depth,
        returning_viewer_pct = EXCLUDED.returning_viewer_pct,
        posts_served = EXCLUDED.posts_served,
        posts_with_engagement = EXCLUDED.posts_with_engagement,
        engagement_rate = EXCLUDED.engagement_rate,
        avg_engagement_position = EXCLUDED.avg_engagement_position`,
      [
        epochId,
        parseInt(stats.total_feed_loads) || 0,
        parseInt(stats.unique_viewers) || 0,
        parseFloat(stats.avg_scroll_depth) || null,
        parseFloat(stats.returning_viewer_pct) || null,
        parseInt(stats.posts_served) || 0,
        parseInt(engagement.engaged) || 0,
        parseFloat(engagement.engagement_rate) || null,
        parseFloat(engagement.avg_engagement_position) || null,
      ]
    );

    logger.debug({ epochId }, 'Epoch engagement stats computed');
  } catch (err) {
    logger.error({ err }, 'Epoch engagement stats computation failed');
  }
}

// ── Job 2.5: Engagement Trend Alerting ─────────────────────────

let consecutiveTrendDrops = 0;

async function checkEngagementTrends(): Promise<void> {
  try {
    // Compare most recent engagement rate to 7-day average
    const result = await db.query(`
      WITH recent AS (
        SELECT engagement_rate
        FROM epoch_engagement_stats
        WHERE computed_at > NOW() - INTERVAL '24 hours'
        ORDER BY computed_at DESC
        LIMIT 1
      ),
      avg_7d AS (
        SELECT AVG(engagement_rate) as avg_rate, COUNT(*) as sample_count
        FROM epoch_engagement_stats
        WHERE computed_at > NOW() - INTERVAL '7 days'
          AND computed_at <= NOW() - INTERVAL '24 hours'
      )
      SELECT
        r.engagement_rate as current_rate,
        a.avg_rate as avg_7d_rate,
        a.sample_count
      FROM recent r, avg_7d a
    `);

    if (result.rows.length === 0 || !result.rows[0].avg_7d_rate) {
      // Not enough data yet
      return;
    }

    const { current_rate, avg_7d_rate, sample_count } = result.rows[0];

    // Need at least 3 data points for meaningful comparison
    if (parseInt(sample_count) < 3) return;

    const currentRate = parseFloat(current_rate);
    const avgRate = parseFloat(avg_7d_rate);

    if (avgRate === 0) return;

    const dropPercent = ((avgRate - currentRate) / avgRate) * 100;

    if (dropPercent > 50) {
      consecutiveTrendDrops++;

      if (consecutiveTrendDrops >= 2) {
        logger.warn(
          {
            current_rate: currentRate,
            avg_7d_rate: avgRate,
            drop_percent: Math.round(dropPercent),
            consecutive_drops: consecutiveTrendDrops,
          },
          'Engagement rate dropped >50% vs 7-day average for 2+ consecutive checks'
        );

        // Store alert in system_status
        await db.query(
          `INSERT INTO system_status (key, value, updated_at)
           VALUES ('engagement_alert', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify({
            type: 'engagement_drop',
            current_rate: currentRate,
            avg_7d_rate: avgRate,
            drop_percent: Math.round(dropPercent),
            consecutive_drops: consecutiveTrendDrops,
            detected_at: new Date().toISOString(),
          })]
        );
      }
    } else {
      // Reset counter if engagement recovered
      if (consecutiveTrendDrops > 0) {
        consecutiveTrendDrops = 0;
        // Clear alert
        await db.query(
          `DELETE FROM system_status WHERE key = 'engagement_alert'`
        ).catch(() => {});
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Engagement trend check failed (non-fatal)');
  }
}

// ── Job 3: Retention Cleanup ────────────────────────────────────

async function retentionCleanup(): Promise<void> {
  try {
    const feedResult = await db.query(
      `DELETE FROM feed_requests
       WHERE requested_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [RETENTION_DAYS]
    );

    const attrResult = await db.query(
      `DELETE FROM engagement_attributions
       WHERE served_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [RETENTION_DAYS]
    );

    const feedDeleted = feedResult.rowCount ?? 0;
    const attrDeleted = attrResult.rowCount ?? 0;

    if (feedDeleted > 0 || attrDeleted > 0) {
      logger.info(
        { feedDeleted, attrDeleted, retentionDays: RETENTION_DAYS },
        'Interaction retention cleanup complete'
      );

      // VACUUM ANALYZE if significant rows deleted
      if (feedDeleted + attrDeleted > 1000) {
        try {
          await db.query('VACUUM (ANALYZE) feed_requests');
          await db.query('VACUUM (ANALYZE) engagement_attributions');
          logger.info('VACUUM ANALYZE on interaction tables complete');
        } catch (err) {
          logger.warn({ err }, 'VACUUM on interaction tables failed (non-fatal)');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Interaction retention cleanup failed');
  }
}
