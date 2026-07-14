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
import { tryTriggerManualScoringRun } from '../../scoring/scheduler.js';
import { logger } from '../../lib/logger.js';
import { adminSecurity } from '../../lib/openapi.js';
import {
  getJetstreamDisconnectedAt,
  getJetstreamEventsLast5Min,
  getJetstreamRuntimeState,
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
    const jetstreamRuntime = getJetstreamRuntimeState();
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
        cursorUs: jetstreamRuntime.cursorUs,
        cursorLagMs: jetstreamRuntime.cursorLagMs,
        activeEvents: jetstreamRuntime.activeEvents,
        pendingEvents: jetstreamRuntime.pendingEvents,
        inboundPaused: jetstreamRuntime.inboundPaused,
        pauseCount: jetstreamRuntime.pauseCount,
        resumeCount: jetstreamRuntime.resumeCount,
        overloadReconnectCount: jetstreamRuntime.overloadReconnectCount,
        totalDroppedEvents: jetstreamRuntime.totalDroppedEvents,
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
      description: 'Manually triggers the scoring pipeline to rescore the feed.',
      security: adminSecurity,
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    if (!(await tryTriggerManualScoringRun())) {
      logger.warn({ adminDid }, 'Manual rescore rejected because scoring is already in progress');
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Scoring pipeline is already running. Try again after it completes.',
      });
    }

    // Log to audit
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ('manual_rescore', $1, $2)`,
      [adminDid, JSON.stringify({ triggeredAt: new Date().toISOString() })]
    );

    logger.info({ adminDid }, 'Manual rescore triggered by admin');

    return reply.send({
      success: true,
      message: 'Scoring pipeline started. Check feed-health endpoint for results.',
    });
  });
}
