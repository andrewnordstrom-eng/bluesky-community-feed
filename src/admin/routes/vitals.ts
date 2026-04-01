/**
 * Admin Vitals Route
 *
 * GET /api/admin/vitals - Single endpoint aggregating all system health:
 * disk, database, Redis, ingestion, scoring, feed, cleanup, engagement.
 *
 * Designed to answer "is the feed healthy?" at a glance.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { getDiskStatus } from '../../maintenance/disk-monitor.js';
import { getHealthStatus } from '../../lib/health.js';
import {
  getLastEventReceivedAt,
  getJetstreamEventsLast5Min,
  isJetstreamConnected,
  getJetstreamDisconnectedAt,
} from '../../ingestion/jetstream.js';
import { logger } from '../../lib/logger.js';

export function registerVitalsRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/vitals
   * Unified system health dashboard in a single JSON response.
   */
  app.get('/vitals', async (_request: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();

    // Gather all vitals in parallel where possible
    const [
      healthStatus,
      dbSizeResult,
      tableSizesResult,
      walResult,
      feedSize,
      feedUpdatedAt,
      feedEpoch,
      redisInfo,
      systemStatusRows,
      subscriberStats,
      engagementStats,
      feedQualityResult,
    ] = await Promise.all([
      getHealthStatus(),
      safeQuery<{ size_bytes: string }>(
        `SELECT pg_database_size(current_database()) as size_bytes`
      ),
      safeQuery<{ table_name: string; size_bytes: string }>(
        `SELECT relname as table_name, pg_total_relation_size(relid) as size_bytes
         FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10`
      ),
      safeQuery<{ wal_bytes: string }>(
        `SELECT COALESCE(SUM(size), 0) as wal_bytes FROM pg_ls_waldir()`
      ),
      redis.zcard('feed:current').catch(() => 0),
      redis.get('feed:updated_at').catch(() => null),
      redis.get('feed:epoch').catch(() => null),
      redis.info('memory').catch(() => ''),
      safeQuery<{ key: string; value: Record<string, unknown>; updated_at: string }>(
        `SELECT key, value, updated_at::text FROM system_status
         WHERE key IN ('current_scoring_run', 'last_cleanup_run', 'disk_status', 'last_emergency_vacuum', 'engagement_alert')`
      ),
      safeQuery<{ total: string; active_24h: string; active_7d: string }>(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '24 hours') as active_24h,
           COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '7 days') as active_7d
         FROM subscribers WHERE is_active = TRUE`
      ),
      safeQuery<{ epoch_id: string; engagement_rate: string; viewer_count: string; computed_at: string }>(
        `SELECT epoch_id::text, engagement_rate::text, viewer_count::text, computed_at::text
         FROM epoch_engagement_stats ORDER BY computed_at DESC LIMIT 7`
      ),
      safeQuery<{ dead_count: string; total_scored: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE ps.final_score IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM likes l WHERE l.subject_uri = p.uri
           ) AND NOT EXISTS (
             SELECT 1 FROM reposts r WHERE r.subject_uri = p.uri
           )) as dead_count,
           COUNT(*) as total_scored
         FROM posts p
         JOIN post_scores ps ON ps.uri = p.uri
         WHERE p.indexed_at > NOW() - INTERVAL '24 hours' AND p.deleted = FALSE`
      ),
    ]);

    // Parse Redis memory info
    const redisMemory = parseRedisMemory(redisInfo);

    // Build system_status lookup
    const statusMap = new Map<string, { value: Record<string, unknown>; updated_at: string }>();
    if (systemStatusRows) {
      for (const row of systemStatusRows) {
        statusMap.set(row.key, { value: row.value, updated_at: row.updated_at });
      }
    }

    const scoringRun = statusMap.get('current_scoring_run');
    const cleanupRun = statusMap.get('last_cleanup_run');
    const emergencyVacuum = statusMap.get('last_emergency_vacuum');
    const engagementAlert = statusMap.get('engagement_alert');

    // Disk
    const diskStatus = getDiskStatus();

    // Ingestion
    const connected = isJetstreamConnected();
    const lastEventAt = getLastEventReceivedAt();
    const disconnectedAt = getJetstreamDisconnectedAt();

    // Feed freshness
    let feedAgeMs: number | undefined;
    if (feedUpdatedAt) {
      feedAgeMs = Date.now() - new Date(feedUpdatedAt).getTime();
    }

    // Feed quality
    const deadCount = feedQualityResult ? parseInt(feedQualityResult[0]?.dead_count ?? '0', 10) : 0;
    const totalScored = feedQualityResult ? parseInt(feedQualityResult[0]?.total_scored ?? '0', 10) : 0;
    const deadContentRatio = totalScored > 0 ? Math.round((deadCount / totalScored) * 100) / 100 : 0;

    const vitals = {
      overall: healthStatus.status,
      collected_at: new Date().toISOString(),
      collection_ms: Date.now() - start,

      disk: diskStatus
        ? {
            used_percent: diskStatus.used_percent,
            available_gb: diskStatus.available_gb,
            total_gb: diskStatus.total_gb,
            level: diskStatus.level,
            last_checked_at: diskStatus.last_checked_at,
            last_emergency_vacuum: emergencyVacuum?.value ?? null,
          }
        : null,

      database: {
        size_mb: dbSizeResult
          ? Math.round(Number(dbSizeResult[0]?.size_bytes ?? 0) / (1024 * 1024))
          : null,
        wal_size_mb: walResult
          ? Math.round(Number(walResult[0]?.wal_bytes ?? 0) / (1024 * 1024))
          : null,
        table_sizes: tableSizesResult
          ? tableSizesResult.map((r) => ({
              table: r.table_name,
              size_mb: Math.round(Number(r.size_bytes) / (1024 * 1024)),
            }))
          : null,
        latency_ms: healthStatus.components.database.latency_ms,
      },

      redis: {
        memory_used_mb: redisMemory.usedMb,
        memory_max_mb: redisMemory.maxMb,
        feed_size: feedSize,
        feed_updated_at: feedUpdatedAt,
        feed_epoch: feedEpoch,
      },

      ingestion: {
        connected,
        events_last_5min: getJetstreamEventsLast5Min(),
        last_event_at: lastEventAt?.toISOString() ?? null,
        last_event_age_ms: lastEventAt ? Date.now() - lastEventAt.getTime() : null,
        disconnected_since: !connected && disconnectedAt ? disconnectedAt.toISOString() : null,
      },

      scoring: scoringRun
        ? {
            last_run_at: getStatusField(scoringRun.value, 'timestamp'),
            duration_ms: getStatusField(scoringRun.value, 'duration_ms'),
            posts_scored: getStatusField(scoringRun.value, 'posts_scored'),
            posts_filtered: getStatusField(scoringRun.value, 'posts_filtered'),
            is_running: healthStatus.components.scoring.is_running,
          }
        : { is_running: false, last_run_at: null },

      feed: {
        count: feedSize,
        epoch_id: feedEpoch,
        freshness_ms: feedAgeMs ?? null,
        dead_content_ratio: deadContentRatio,
      },

      cleanup: cleanupRun
        ? {
            last_run: cleanupRun.updated_at,
            ...cleanupRun.value,
          }
        : null,

      engagement: {
        recent: engagementStats
          ? engagementStats.map((e) => ({
              epoch_id: e.epoch_id,
              engagement_rate: parseFloat(e.engagement_rate),
              viewer_count: parseInt(e.viewer_count, 10),
              computed_at: e.computed_at,
            }))
          : [],
        alert: engagementAlert?.value ?? null,
      },

      subscribers: subscriberStats
        ? {
            total: parseInt(subscriberStats[0]?.total ?? '0', 10),
            active_24h: parseInt(subscriberStats[0]?.active_24h ?? '0', 10),
            active_7d: parseInt(subscriberStats[0]?.active_7d ?? '0', 10),
          }
        : null,
    };

    return reply.send(vitals);
  });
}

/**
 * Safely extract a field from a system_status JSON value.
 */
function getStatusField(value: Record<string, unknown>, key: string): unknown {
  if (value && typeof value === 'object' && key in value) {
    return value[key];
  }
  return null;
}

/**
 * Safe query wrapper — returns rows or null on error.
 */
async function safeQuery<T>(sql: string): Promise<T[] | null> {
  try {
    const result = await db.query(sql);
    return result.rows as T[];
  } catch (err) {
    logger.warn({ err, sql: sql.substring(0, 80) }, 'Vitals query failed');
    return null;
  }
}

/**
 * Parse Redis INFO memory output for used_memory and maxmemory.
 */
function parseRedisMemory(info: string): { usedMb: number | null; maxMb: number | null } {
  const usedMatch = info.match(/used_memory:(\d+)/);
  const maxMatch = info.match(/maxmemory:(\d+)/);

  return {
    usedMb: usedMatch ? Math.round(Number(usedMatch[1]) / (1024 * 1024)) : null,
    maxMb: maxMatch && Number(maxMatch[1]) > 0 ? Math.round(Number(maxMatch[1]) / (1024 * 1024)) : null,
  };
}
