/**
 * Admin Feed Health Routes
 *
 * GET /api/admin/feed-health - Detailed feed statistics
 * POST /api/admin/feed/rescore - Manually trigger scoring pipeline
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { getScoringStatus } from '../status-tracker.js';
import { getAdminDid } from '../../auth/admin.js';
import { enqueueManualScoringRun } from '../../scoring/scheduler.js';
import { logger } from '../../lib/logger.js';
import { adminSecurity } from '../../lib/openapi.js';
import { config } from '../../config.js';
import { rankingRequestQueue } from '../../scoring/ranking-request-queue.js';
import { readRankingWorkerHealth } from '../../scoring/ranking-worker.js';
import {
  getJetstreamDisconnectedAt,
  getJetstreamEventsLast5Min,
  getLastEventReceivedAt,
  isJetstreamConnected,
  triggerJetstreamReconnect,
} from '../../ingestion/jetstream.js';

export function registerFeedHealthRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/feed-health
   * Detailed feed statistics
   */
  app.get('/feed-health', {
    schema: {
      tags: ['Admin'],
      summary: 'Feed health',
      description: 'Returns detailed feed ingestion and scoring health statistics.',
      security: adminSecurity,
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // Database stats
    const dbStats = await db.query(`
      SELECT
        COUNT(*) as total_posts,
        COUNT(*) FILTER (WHERE indexed_at > NOW() - INTERVAL '24 hours') as posts_24h,
        COUNT(*) FILTER (WHERE indexed_at > NOW() - INTERVAL '7 days') as posts_7d,
        MIN(indexed_at) as oldest_post,
        MAX(indexed_at) as newest_post
      FROM posts
      WHERE deleted = FALSE
    `);

    // Scoring status
    const scoringStatus = await getScoringStatus();

    // Jetstream status from ingestion runtime state
    const connected = isJetstreamConnected();
    const lastEventAt = getLastEventReceivedAt();
    const disconnectedAt = getJetstreamDisconnectedAt();
    const disconnectedForSeconds =
      !connected && disconnectedAt
        ? Math.max(0, Math.floor((Date.now() - disconnectedAt.getTime()) / 1000))
        : null;

    // Subscriber stats
    const subStats = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (
          WHERE did IN (SELECT DISTINCT voter_did FROM governance_votes)
        ) as with_votes,
        COUNT(*) FILTER (
          WHERE last_seen > NOW() - INTERVAL '7 days'
        ) as active_last_week
      FROM subscribers
      WHERE is_active = TRUE
    `);

    // Content rules from current epoch
    const epochResult = await db.query(`
      SELECT content_rules, created_at as rules_updated
      FROM governance_epochs
      WHERE status IN ('active', 'voting')
      LIMIT 1
    `);

    const contentRules = epochResult.rows[0]?.content_rules || {
      include_keywords: [],
      exclude_keywords: [],
    };

    // Feed size from Redis
    let feedSize = 0;
    try {
      feedSize = await redis.zcard('feed:current');
    } catch (err) {
      logger.warn({ err }, 'Failed to get feed size from Redis');
    }

    let rankingWorker: Awaited<ReturnType<typeof readRankingWorkerHealth>> | null = null;
    try {
      rankingWorker = await readRankingWorkerHealth(
        redis,
        rankingRequestQueue,
        config.RANKING_COMMUNITY_ID,
        new Date(),
        config.RANKING_WORKER_HEARTBEAT_TTL_MS
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to get ranking worker health');
    }

    return reply.send({
      database: {
        totalPosts: parseInt(dbStats.rows[0].total_posts, 10),
        postsLast24h: parseInt(dbStats.rows[0].posts_24h, 10),
        postsLast7d: parseInt(dbStats.rows[0].posts_7d, 10),
        oldestPost: dbStats.rows[0].oldest_post,
        newestPost: dbStats.rows[0].newest_post,
      },
      scoring: {
        lastRun: scoringStatus.timestamp,
        lastRunDuration: scoringStatus.duration_ms,
        postsScored: scoringStatus.posts_scored,
        postsFiltered: scoringStatus.posts_filtered,
      },
      jetstream: {
        connected,
        lastEvent: lastEventAt ? lastEventAt.toISOString() : null,
        eventsLast5min: getJetstreamEventsLast5Min(),
        disconnectedForSeconds,
      },
      subscribers: {
        total: parseInt(subStats.rows[0].total, 10),
        withVotes: parseInt(subStats.rows[0].with_votes, 10),
        activeLastWeek: parseInt(subStats.rows[0].active_last_week, 10),
      },
      contentRules: {
        includeKeywords: contentRules.include_keywords || [],
        excludeKeywords: contentRules.exclude_keywords || [],
        lastUpdated: epochResult.rows[0]?.rules_updated,
      },
      feedSize,
      rankingWorker,
    });
  });

  /**
   * POST /api/admin/jetstream/reconnect
   * Trigger a manual reconnect cycle for Jetstream ingestion.
   */
  app.post('/jetstream/reconnect', {
    schema: {
      tags: ['Admin'],
      summary: 'Reconnect Jetstream',
      description: 'Triggers a manual reconnect cycle for Jetstream ingestion.',
      security: adminSecurity,
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    triggerJetstreamReconnect();

    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ('admin_jetstream_reconnect', $1, $2)`,
      [adminDid, JSON.stringify({ triggeredAt: new Date().toISOString() })]
    );

    logger.info({ adminDid }, 'Manual Jetstream reconnect triggered by admin');

    return reply.send({
      success: true,
      message: 'Jetstream reconnect triggered.',
    });
  });

  /**
   * POST /api/admin/feed/rescore
   * Manually trigger scoring pipeline
   */
  app.post('/feed/rescore', {
    schema: {
      tags: ['Admin'],
      summary: 'Rescore feed',
      description: 'Durably queues an idempotent scoring request for the ranking worker.',
      security: adminSecurity,
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    let rankingRequest: Awaited<ReturnType<typeof enqueueManualScoringRun>>;
    try {
      rankingRequest = await enqueueManualScoringRun(adminDid, new Date());
    } catch (err) {
      logger.error({ err, adminDid }, 'Manual rescore queueing failed');
      return reply.code(503).send({
        error: 'RankingQueueUnavailable',
        message: 'The ranking request could not be queued. No ranking was started.',
      });
    }

    // The durable queue write is authoritative. An auxiliary audit failure
    // must not tell the caller that an already-queued request was rejected.
    try {
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, details)
         VALUES ('manual_rescore', $1, $2)`,
        [adminDid, JSON.stringify({
          requestId: rankingRequest.id,
          idempotencyKey: rankingRequest.idempotencyKey,
          created: rankingRequest.created,
          queuedAt: new Date().toISOString(),
        })]
      );
    } catch (error) {
      logger.error(
        { err: error, adminDid, requestId: rankingRequest.id },
        'Manual rescore was queued but governance audit persistence failed'
      );
    }

    logger.info(
      { adminDid, requestId: rankingRequest.id, created: rankingRequest.created },
      'Manual rescore queued by admin'
    );

    return reply.code(202).send({
      success: true,
      queued: true,
      requestId: rankingRequest.id,
      idempotencyKey: rankingRequest.idempotencyKey,
      created: rankingRequest.created,
      message: 'Scoring request queued. Check feed-health for worker progress.',
    });
  });
}
