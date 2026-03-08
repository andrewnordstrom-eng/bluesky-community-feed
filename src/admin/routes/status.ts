/**
 * Admin Status Routes
 *
 * GET /api/admin/status - Returns system overview for admin dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { config } from '../../config.js';
import { adminSecurity } from '../../lib/openapi.js';
import { getCurrentContentRules } from '../../governance/content-filter.js';

export function registerStatusRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/ping
   * Simple test endpoint
   */
  app.get('/ping', {
    schema: {
      tags: ['Admin'],
      summary: 'Ping',
      description: 'Simple admin test endpoint. Returns timestamp.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            pong: { type: 'boolean' },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['pong', 'timestamp'],
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ pong: true, timestamp: new Date().toISOString() });
  });

  /**
   * GET /api/admin/status
   * Returns admin status check and system overview
   */
  app.get('/status', {
    schema: {
      tags: ['Admin'],
      summary: 'System status',
      description: 'Returns a full system overview for the admin dashboard: epoch state, feed stats, scoring info, content rules, and subscriber count.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            isAdmin: { type: 'boolean' },
            feedPrivateMode: { type: 'boolean' },
            system: {
              type: 'object',
              properties: {
                currentEpoch: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    id: { type: 'integer' },
                    status: { type: 'string' },
                    phase: { type: 'string' },
                    votingOpen: { type: 'boolean' },
                    votingEndsAt: { type: 'string', format: 'date-time', nullable: true },
                    autoTransition: { type: 'boolean' },
                    voteCount: { type: 'integer' },
                    weights: { type: 'object' },
                    contentRules: { type: 'object' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
                feed: {
                  type: 'object',
                  properties: {
                    totalPosts: { type: 'integer' },
                    postsLast24h: { type: 'integer' },
                    scoredPosts: { type: 'integer' },
                    lastScoringRun: { type: 'string', format: 'date-time', nullable: true },
                    lastScoringDuration: { type: 'number', nullable: true, description: 'Duration in seconds' },
                    subscriberCount: { type: 'integer' },
                  },
                },
                contentRules: {
                  type: 'object',
                  properties: {
                    includeKeywords: { type: 'array', items: { type: 'string' } },
                    excludeKeywords: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          required: ['isAdmin', 'system'],
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // Get current epoch
    const epochResult = await db.query(`
      SELECT
        id,
        status,
        phase,
        voting_ends_at,
        auto_transition,
        recency_weight,
        engagement_weight,
        bridging_weight,
        source_diversity_weight,
        relevance_weight,
        content_rules,
        created_at
      FROM governance_epochs
      WHERE status IN ('active', 'voting')
      ORDER BY id DESC
      LIMIT 1
    `);

    const currentEpoch = epochResult.rows[0] || null;

    // Get vote count for current epoch
    let voteCount = 0;
    if (currentEpoch) {
      const voteResult = await db.query(
        `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
        [currentEpoch.id]
      );
      voteCount = parseInt(voteResult.rows[0].count, 10);
    }

    // Get feed stats
    const feedStats = await db.query(`
      SELECT
        COUNT(*) as total_posts,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as posts_24h
      FROM posts
      WHERE deleted = FALSE
    `);

    // Get subscriber count
    const subResult = await db.query(
      `SELECT COUNT(*) as count FROM subscribers WHERE is_active = TRUE`
    );

    // Get scoring stats from system_status table
    let lastScoringRun: string | null = null;
    let lastScoringDuration: number | null = null;
    let scoredPosts = 0;
    try {
      const scoringStatus = await db.query(
        `SELECT value FROM system_status WHERE key = 'last_scoring_run'`
      );
      if (scoringStatus.rows[0]?.value) {
        const val = scoringStatus.rows[0].value;
        lastScoringRun = val.timestamp || null;
        lastScoringDuration = val.duration_ms ? val.duration_ms / 1000 : null;
        scoredPosts = val.posts_scored || 0;
      }
    } catch {
      // system_status table might not exist
    }

    // Get feed size from Redis
    let feedSize = 0;
    try {
      feedSize = await redis.zcard('feed:current');
    } catch {
      // Redis might not be connected
    }

    // Get current content rules
    const contentRules = await getCurrentContentRules();

    return reply.send({
      isAdmin: true,
      feedPrivateMode: config.FEED_PRIVATE_MODE,
      system: {
        currentEpoch: currentEpoch
          ? {
              id: currentEpoch.id,
              status: currentEpoch.status,
              phase: currentEpoch.phase ?? 'running',
              votingOpen: currentEpoch.phase === 'voting' || currentEpoch.status === 'voting',
              votingEndsAt: currentEpoch.voting_ends_at,
              autoTransition: currentEpoch.auto_transition || false,
              voteCount,
              weights: {
                recency: parseFloat(currentEpoch.recency_weight),
                engagement: parseFloat(currentEpoch.engagement_weight),
                bridging: parseFloat(currentEpoch.bridging_weight),
                sourceDiversity: parseFloat(currentEpoch.source_diversity_weight),
                relevance: parseFloat(currentEpoch.relevance_weight),
              },
              contentRules: currentEpoch.content_rules || { include_keywords: [], exclude_keywords: [] },
              createdAt: currentEpoch.created_at,
            }
          : null,
        feed: {
          totalPosts: parseInt(feedStats.rows[0].total_posts, 10),
          postsLast24h: parseInt(feedStats.rows[0].posts_24h, 10),
          scoredPosts: feedSize || scoredPosts,
          lastScoringRun,
          lastScoringDuration,
          subscriberCount: parseInt(subResult.rows[0].count, 10),
        },
        contentRules: {
          includeKeywords: contentRules.includeKeywords || [],
          excludeKeywords: contentRules.excludeKeywords || [],
        },
      },
    });
  });
}
