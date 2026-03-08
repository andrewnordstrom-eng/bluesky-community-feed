/**
 * Admin Interaction Routes
 *
 * GET /api/admin/interactions/overview     - Today's stats, yesterday's, 7-day trend
 * GET /api/admin/interactions/scroll-depth - Scroll depth histogram
 * GET /api/admin/interactions/engagement   - Attribution stats by position
 * GET /api/admin/interactions/epoch-comparison - Engagement stats across epochs
 * GET /api/admin/interactions/keyword-performance - Per-keyword engagement rates
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';

export function registerInteractionRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/interactions/overview
   * Today's live stats, yesterday's stats, and 7-day trend.
   */
  app.get('/interactions/overview', {
    schema: {
      tags: ['Admin'],
      summary: 'Interaction overview',
      description:
        "Today's live stats, yesterday's pre-aggregated stats, and a 7-day trend of " +
        'total requests, unique viewers, scroll depth, and returning viewers.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            today: {
              type: 'object',
              properties: {
                totalRequests: { type: 'integer' },
                uniqueViewers: { type: 'integer' },
                anonymousRequests: { type: 'integer' },
                avgScrollDepth: { type: 'number' },
                avgResponseTimeMs: { type: 'number' },
                returningViewers: { type: 'integer' },
              },
            },
            yesterday: {
              type: 'object',
              nullable: true,
              properties: {
                totalRequests: { type: 'integer' },
                uniqueViewers: { type: 'integer' },
                anonymousRequests: { type: 'integer' },
                avgScrollDepth: { type: 'number' },
                returningViewers: { type: 'integer' },
              },
            },
            trend: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', format: 'date' },
                  totalRequests: { type: 'integer' },
                  uniqueViewers: { type: 'integer' },
                  anonymousRequests: { type: 'integer' },
                  maxScrollDepth: { type: 'integer' },
                  avgPagesPerSession: { type: 'number' },
                  returningViewers: { type: 'integer' },
                },
              },
            },
          },
          required: ['today', 'trend'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Today's live stats (from feed_requests, not yet aggregated)
      const todayResult = await db.query(`
        SELECT
          COUNT(*) AS total_requests,
          COUNT(DISTINCT viewer_did) FILTER (WHERE viewer_did IS NOT NULL) AS unique_viewers,
          COUNT(*) FILTER (WHERE viewer_did IS NULL) AS anonymous_requests,
          AVG(page_offset + posts_served)::float AS avg_scroll_depth,
          AVG(response_time_ms)::float AS avg_response_time_ms
        FROM feed_requests
        WHERE requested_at::date = CURRENT_DATE
      `);

      // Returning viewers today
      const returningResult = await db.query(`
        SELECT COUNT(DISTINCT fr.viewer_did) AS returning_viewers
        FROM feed_requests fr
        WHERE fr.requested_at::date = CURRENT_DATE
          AND fr.viewer_did IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM feed_requests fr2
            WHERE fr2.viewer_did = fr.viewer_did
              AND fr2.requested_at::date < CURRENT_DATE
          )
      `);

      // Yesterday from daily stats (pre-aggregated)
      const yesterdayResult = await db.query(`
        SELECT *
        FROM feed_request_daily_stats
        WHERE date = CURRENT_DATE - 1
        ORDER BY epoch_id DESC
        LIMIT 1
      `);

      // 7-day trend from daily stats
      const trendResult = await db.query(`
        SELECT
          date,
          SUM(total_requests) AS total_requests,
          SUM(unique_viewers) AS unique_viewers,
          SUM(anonymous_requests) AS anonymous_requests,
          MAX(max_scroll_depth) AS max_scroll_depth,
          AVG(avg_pages_per_session)::float AS avg_pages_per_session,
          SUM(returning_viewers) AS returning_viewers
        FROM feed_request_daily_stats
        WHERE date >= CURRENT_DATE - 7
        GROUP BY date
        ORDER BY date ASC
      `);

      const today = todayResult.rows[0];
      const returning = returningResult.rows[0];
      const yesterday = yesterdayResult.rows[0] ?? null;

      return reply.send({
        today: {
          totalRequests: parseInt(today.total_requests) || 0,
          uniqueViewers: parseInt(today.unique_viewers) || 0,
          anonymousRequests: parseInt(today.anonymous_requests) || 0,
          avgScrollDepth: parseFloat(today.avg_scroll_depth) || 0,
          avgResponseTimeMs: parseFloat(today.avg_response_time_ms) || 0,
          returningViewers: parseInt(returning.returning_viewers) || 0,
        },
        yesterday: yesterday
          ? {
              totalRequests: yesterday.total_requests,
              uniqueViewers: yesterday.unique_viewers,
              anonymousRequests: yesterday.anonymous_requests,
              avgScrollDepth: yesterday.max_scroll_depth,
              returningViewers: yesterday.returning_viewers,
            }
          : null,
        trend: trendResult.rows.map((row) => ({
          date: row.date,
          totalRequests: parseInt(row.total_requests) || 0,
          uniqueViewers: parseInt(row.unique_viewers) || 0,
          anonymousRequests: parseInt(row.anonymous_requests) || 0,
          maxScrollDepth: parseInt(row.max_scroll_depth) || 0,
          avgPagesPerSession: parseFloat(row.avg_pages_per_session) || 0,
          returningViewers: parseInt(row.returning_viewers) || 0,
        })),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get interaction overview');
      return reply.code(500).send({ error: 'InternalError', message: 'Failed to get interaction overview' });
    }
  });

  /**
   * GET /api/admin/interactions/scroll-depth
   * Scroll depth histogram by session.
   */
  app.get('/interactions/scroll-depth', {
    schema: {
      tags: ['Admin'],
      summary: 'Scroll depth histogram',
      description: 'Returns a histogram of scroll depth by session for the last 7 days, bucketed by page count.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            histogram: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  bucket: { type: 'string', description: 'Depth bucket label (e.g. "1 page", "2-3 pages")' },
                  sessionCount: { type: 'integer' },
                },
              },
            },
          },
          required: ['histogram'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await db.query(`
        WITH session_depth AS (
          SELECT
            snapshot_id,
            MAX(page_offset + posts_served) AS max_depth
          FROM feed_requests
          WHERE requested_at > NOW() - INTERVAL '7 days'
          GROUP BY snapshot_id
        )
        SELECT
          CASE
            WHEN max_depth <= 50 THEN '1 page'
            WHEN max_depth <= 150 THEN '2-3 pages'
            WHEN max_depth <= 250 THEN '4-5 pages'
            ELSE '6+ pages'
          END AS bucket,
          COUNT(*) AS session_count
        FROM session_depth
        GROUP BY
          CASE
            WHEN max_depth <= 50 THEN '1 page'
            WHEN max_depth <= 150 THEN '2-3 pages'
            WHEN max_depth <= 250 THEN '4-5 pages'
            ELSE '6+ pages'
          END
        ORDER BY MIN(max_depth)
      `);

      return reply.send({
        histogram: result.rows.map((row) => ({
          bucket: row.bucket,
          sessionCount: parseInt(row.session_count) || 0,
        })),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get scroll depth');
      return reply.code(500).send({ error: 'InternalError', message: 'Failed to get scroll depth' });
    }
  });

  /**
   * GET /api/admin/interactions/engagement
   * Attribution stats: served vs engaged by position bucket.
   */
  app.get('/interactions/engagement', {
    schema: {
      tags: ['Admin'],
      summary: 'Engagement attribution stats',
      description:
        'Returns overall engagement attribution stats (served vs engaged, likes, reposts) and ' +
        'a breakdown by feed position bucket for the last 7 days.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            overall: {
              type: 'object',
              properties: {
                totalServed: { type: 'integer' },
                totalEngaged: { type: 'integer' },
                engagementRate: { type: 'number' },
                likes: { type: 'integer' },
                reposts: { type: 'integer' },
              },
            },
            byPosition: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  bucket: { type: 'string', description: 'Position bucket (e.g. "Top 10", "11-25")' },
                  served: { type: 'integer' },
                  engaged: { type: 'integer' },
                  rate: { type: 'number' },
                },
              },
            },
          },
          required: ['overall', 'byPosition'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Overall stats
      const overallResult = await db.query(`
        SELECT
          COUNT(*) AS total_served,
          COUNT(*) FILTER (WHERE engaged_at IS NOT NULL) AS total_engaged,
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE COUNT(*) FILTER (WHERE engaged_at IS NOT NULL)::float / COUNT(*)
          END AS engagement_rate,
          COUNT(*) FILTER (WHERE engagement_type = 'like') AS likes,
          COUNT(*) FILTER (WHERE engagement_type = 'repost') AS reposts
        FROM engagement_attributions
        WHERE served_at > NOW() - INTERVAL '7 days'
      `);

      // By position bucket
      const positionResult = await db.query(`
        SELECT
          CASE
            WHEN position_in_feed < 10 THEN 'Top 10'
            WHEN position_in_feed < 25 THEN '11-25'
            WHEN position_in_feed < 50 THEN '26-50'
            ELSE '50+'
          END AS position_bucket,
          COUNT(*) AS served,
          COUNT(*) FILTER (WHERE engaged_at IS NOT NULL) AS engaged,
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE COUNT(*) FILTER (WHERE engaged_at IS NOT NULL)::float / COUNT(*)
          END AS rate
        FROM engagement_attributions
        WHERE served_at > NOW() - INTERVAL '7 days'
        GROUP BY
          CASE
            WHEN position_in_feed < 10 THEN 'Top 10'
            WHEN position_in_feed < 25 THEN '11-25'
            WHEN position_in_feed < 50 THEN '26-50'
            ELSE '50+'
          END
        ORDER BY MIN(position_in_feed)
      `);

      const overall = overallResult.rows[0];

      return reply.send({
        overall: {
          totalServed: parseInt(overall.total_served) || 0,
          totalEngaged: parseInt(overall.total_engaged) || 0,
          engagementRate: parseFloat(overall.engagement_rate) || 0,
          likes: parseInt(overall.likes) || 0,
          reposts: parseInt(overall.reposts) || 0,
        },
        byPosition: positionResult.rows.map((row) => ({
          bucket: row.position_bucket,
          served: parseInt(row.served) || 0,
          engaged: parseInt(row.engaged) || 0,
          rate: parseFloat(row.rate) || 0,
        })),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get engagement stats');
      return reply.code(500).send({ error: 'InternalError', message: 'Failed to get engagement stats' });
    }
  });

  /**
   * GET /api/admin/interactions/epoch-comparison
   * Engagement stats across all epochs for chart rendering.
   */
  app.get('/interactions/epoch-comparison', {
    schema: {
      tags: ['Admin'],
      summary: 'Epoch engagement comparison',
      description: 'Returns engagement stats across all epochs for chart rendering, including feed loads, viewers, and engagement rates.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            epochs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  epochId: { type: 'integer' },
                  totalFeedLoads: { type: 'integer' },
                  uniqueViewers: { type: 'integer' },
                  avgScrollDepth: { type: 'number', nullable: true },
                  returningViewerPct: { type: 'number', nullable: true },
                  engagementRate: { type: 'number', nullable: true },
                  avgEngagementPosition: { type: 'number', nullable: true },
                  postsServed: { type: 'integer' },
                  postsWithEngagement: { type: 'integer' },
                  computedAt: { type: 'string', format: 'date-time' },
                  epochStartedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
          required: ['epochs'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await db.query(`
        SELECT
          ees.epoch_id,
          ees.total_feed_loads,
          ees.unique_viewers,
          ees.avg_scroll_depth,
          ees.returning_viewer_pct,
          ees.engagement_rate,
          ees.avg_engagement_position,
          ees.posts_served,
          ees.posts_with_engagement,
          ees.computed_at,
          ge.created_at AS epoch_started_at
        FROM epoch_engagement_stats ees
        JOIN governance_epochs ge ON ge.id = ees.epoch_id
        ORDER BY ees.epoch_id ASC
      `);

      return reply.send({
        epochs: result.rows.map((row) => ({
          epochId: row.epoch_id,
          totalFeedLoads: row.total_feed_loads,
          uniqueViewers: row.unique_viewers,
          avgScrollDepth: parseFloat(row.avg_scroll_depth) || null,
          returningViewerPct: parseFloat(row.returning_viewer_pct) || null,
          engagementRate: parseFloat(row.engagement_rate) || null,
          avgEngagementPosition: parseFloat(row.avg_engagement_position) || null,
          postsServed: row.posts_served,
          postsWithEngagement: row.posts_with_engagement,
          computedAt: row.computed_at,
          epochStartedAt: row.epoch_started_at,
        })),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get epoch comparison');
      return reply.code(500).send({ error: 'InternalError', message: 'Failed to get epoch comparison' });
    }
  });

  /**
   * GET /api/admin/interactions/keyword-performance
   * Per-keyword engagement rates from current epoch.
   */
  app.get('/interactions/keyword-performance', {
    schema: {
      tags: ['Admin'],
      summary: 'Keyword engagement performance',
      description:
        'Returns per-keyword engagement rates from the current active epoch, along with the current keyword rules for context.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            keywords: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  keyword: { type: 'string' },
                  served: { type: 'integer' },
                  engaged: { type: 'integer' },
                  rate: { type: 'number' },
                },
              },
            },
            currentRules: {
              type: 'object',
              properties: {
                includeKeywords: { type: 'array', items: { type: 'string' } },
                excludeKeywords: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          required: ['keywords', 'currentRules'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get current epoch's keyword stats from JSONB
      const result = await db.query(`
        SELECT ees.keyword_stats
        FROM epoch_engagement_stats ees
        JOIN governance_epochs ge ON ge.id = ees.epoch_id
        WHERE ge.status = 'active'
        ORDER BY ees.epoch_id DESC
        LIMIT 1
      `);

      const keywordStats = result.rows[0]?.keyword_stats ?? {};

      // Also get current keyword rules for context
      const rulesResult = await db.query(`
        SELECT content_rules
        FROM governance_epochs
        WHERE status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `);

      const contentRules = rulesResult.rows[0]?.content_rules ?? { include_keywords: [], exclude_keywords: [] };

      return reply.send({
        keywords: Object.entries(keywordStats).map(([keyword, stats]) => {
          const s = stats as { served?: number; engaged?: number; rate?: number };
          return {
            keyword,
            served: s.served ?? 0,
            engaged: s.engaged ?? 0,
            rate: s.rate ?? 0,
          };
        }),
        currentRules: {
          includeKeywords: contentRules.include_keywords ?? [],
          excludeKeywords: contentRules.exclude_keywords ?? [],
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get keyword performance');
      return reply.code(500).send({ error: 'InternalError', message: 'Failed to get keyword performance' });
    }
  });

  /**
   * GET /api/admin/interactions/feed-signals
   * Analytics from the sendInteractions API (requestMore, requestLess, etc.).
   * Shows totals by type, per-epoch breakdown, and top posts by signal ratio.
   */
  app.get('/interactions/feed-signals', {
    schema: {
      tags: ['Admin'],
      summary: 'Feed signal analytics',
      description:
        'Analytics from the sendInteractions API (requestMore, requestLess). Shows totals by type ' +
        '(today, yesterday, 7-day), per-epoch breakdown, and top posts by signal ratio.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            byType: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  today: { type: 'integer' },
                  yesterday: { type: 'integer' },
                  last7Days: { type: 'integer' },
                },
              },
            },
            byEpoch: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  epochId: { type: 'integer' },
                  type: { type: 'string' },
                  count: { type: 'integer' },
                  uniqueUsers: { type: 'integer' },
                },
              },
            },
            topPosts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  postUri: { type: 'string' },
                  requestMore: { type: 'integer' },
                  requestLess: { type: 'integer' },
                  totalSignals: { type: 'integer' },
                },
              },
            },
          },
          required: ['byType', 'byEpoch', 'topPosts'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Total interactions by type: today, yesterday, 7-day
      const byTypeResult = await db.query(`
        SELECT
          interaction_type,
          COUNT(*) FILTER (WHERE reported_at::date = CURRENT_DATE) AS today,
          COUNT(*) FILTER (WHERE reported_at::date = CURRENT_DATE - 1) AS yesterday,
          COUNT(*) FILTER (WHERE reported_at >= NOW() - INTERVAL '7 days') AS last_7_days
        FROM feed_interactions
        WHERE reported_at >= NOW() - INTERVAL '8 days'
        GROUP BY interaction_type
        ORDER BY last_7_days DESC
      `);

      // Per-epoch breakdown
      const byEpochResult = await db.query(`
        SELECT
          epoch_id,
          interaction_type,
          COUNT(*) AS count,
          COUNT(DISTINCT requester_did) AS unique_users
        FROM feed_interactions
        WHERE epoch_id IS NOT NULL
        GROUP BY epoch_id, interaction_type
        ORDER BY epoch_id DESC, count DESC
        LIMIT 50
      `);

      // Top posts by requestMore/requestLess ratio (last 7 days)
      const topPostsResult = await db.query(`
        SELECT
          post_uri,
          COUNT(*) FILTER (WHERE interaction_type = 'app.bsky.feed.defs#requestMore') AS request_more,
          COUNT(*) FILTER (WHERE interaction_type = 'app.bsky.feed.defs#requestLess') AS request_less,
          COUNT(*) AS total_signals
        FROM feed_interactions
        WHERE reported_at >= NOW() - INTERVAL '7 days'
        GROUP BY post_uri
        HAVING COUNT(*) >= 3
        ORDER BY
          COUNT(*) FILTER (WHERE interaction_type = 'app.bsky.feed.defs#requestMore')::float
          / GREATEST(COUNT(*) FILTER (WHERE interaction_type = 'app.bsky.feed.defs#requestLess'), 1) DESC
        LIMIT 20
      `);

      return reply.send({
        byType: byTypeResult.rows.map((row) => ({
          type: row.interaction_type,
          today: parseInt(row.today) || 0,
          yesterday: parseInt(row.yesterday) || 0,
          last7Days: parseInt(row.last_7_days) || 0,
        })),
        byEpoch: byEpochResult.rows.map((row) => ({
          epochId: row.epoch_id,
          type: row.interaction_type,
          count: parseInt(row.count) || 0,
          uniqueUsers: parseInt(row.unique_users) || 0,
        })),
        topPosts: topPostsResult.rows.map((row) => ({
          postUri: row.post_uri,
          requestMore: parseInt(row.request_more) || 0,
          requestLess: parseInt(row.request_less) || 0,
          totalSignals: parseInt(row.total_signals) || 0,
        })),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get feed signals');
      return reply.code(500).send({ error: 'InternalError', message: 'Failed to get feed signal analytics' });
    }
  });

  logger.debug('Interaction routes registered');
}
