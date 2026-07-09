/**
 * Feed Stats Route
 *
 * GET /api/transparency/stats
 *
 * Returns bounded aggregate statistics for the current feed:
 * - Current epoch weights and status
 * - Feed snapshot statistics materialized during scoring
 * - Governance info (vote count)
 * - Optional: Gini coefficient for author concentration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { logger } from '../../lib/logger.js';
import { ErrorResponseSchema } from '../../lib/openapi.js';
import type { FeedStats } from '../transparency.types.js';

interface CurrentScoringRunValue {
  run_id?: unknown;
  epoch_id?: unknown;
  posts_scored?: unknown;
  timestamp?: unknown;
}

interface CurrentScoringRunScope {
  runId: string;
  epochId: number;
  postsScored: number | null;
  timestamp: string | null;
}

interface EpochMetricsRow {
  run_id: string | null;
  author_gini: number | string | null;
  avg_bridging: number | string | null;
  median_bridging: number | string | null;
  avg_engagement: number | string | null;
  median_total: number | string | null;
  vs_chronological_overlap: number | string | null;
  vs_engagement_overlap: number | string | null;
  posts_scored: number | string | null;
  unique_authors: number | string | null;
  computed_at: string | Date;
  metrics_source: 'current_feed' | 'legacy' | null;
}

interface FallbackFeedStats {
  totalPostsScored: number;
  runId: string | null;
  computedAt: string | null;
}

async function getCurrentScoringRunScope(): Promise<CurrentScoringRunScope | null> {
  const result = await db.query<{ value: CurrentScoringRunValue }>(
    `SELECT value
     FROM system_status
     WHERE key = 'current_scoring_run'`
  );

  const value = result.rows[0]?.value;
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (typeof value.run_id !== 'string' || typeof value.epoch_id !== 'number') {
    return null;
  }

  return {
    runId: value.run_id,
    epochId: value.epoch_id,
    postsScored: typeof value.posts_scored === 'number' ? value.posts_scored : null,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : null,
  };
}

function numericValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumericValue(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDateTimeOrNull(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readRedisFeedCount(): Promise<number | null> {
  try {
    const value = await redis.get('feed:count');
    return nullableNumericValue(value);
  } catch (err) {
    logger.warn({ err }, 'Failed to read Redis feed count for transparency stats fallback');
    return null;
  }
}

async function getCurrentScoringRunScopeOrNull(): Promise<CurrentScoringRunScope | null> {
  try {
    return await getCurrentScoringRunScope();
  } catch (err) {
    logger.warn({ err }, 'Failed to read current scoring run scope for transparency stats fallback');
    return null;
  }
}

async function buildFallbackFeedStats(epochId: number): Promise<FallbackFeedStats> {
  const runScope = await getCurrentScoringRunScopeOrNull();
  const scopeMatchesEpoch = runScope?.epochId === epochId;
  const redisFeedCount = scopeMatchesEpoch ? await readRedisFeedCount() : null;
  const scopedRunPosts = scopeMatchesEpoch ? runScope.postsScored : null;

  return {
    totalPostsScored: Math.max(scopedRunPosts ?? 0, redisFeedCount ?? 0),
    runId: scopeMatchesEpoch ? runScope.runId : null,
    computedAt: scopeMatchesEpoch ? runScope.timestamp : null,
  };
}

async function readLatestEpochMetrics(epochId: number): Promise<EpochMetricsRow | null> {
  try {
    const result = await db.query<EpochMetricsRow>(
      `SELECT
         run_id,
         author_gini,
         avg_bridging,
         median_bridging,
         avg_engagement,
         median_total,
         vs_chronological_overlap,
         vs_engagement_overlap,
         posts_scored,
         unique_authors,
         computed_at,
         metrics_source
       FROM epoch_metrics
       WHERE epoch_id = $1
       ORDER BY computed_at DESC
       LIMIT 1`,
      [epochId]
    );
    return result.rows[0] ?? null;
  } catch (err) {
    logger.warn({ err, epochId }, 'Failed to read materialized transparency stats; using fallback');
    return null;
  }
}

async function readVoteCount(epochId: number): Promise<number> {
  try {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epochId]
    );
    return parseInt(String(result.rows[0]?.count ?? '0'), 10) || 0;
  } catch (err) {
    logger.warn({ err, epochId }, 'Failed to read governance vote count for transparency stats');
    return 0;
  }
}

export function registerFeedStatsRoute(app: FastifyInstance): void {
  app.get('/api/transparency/stats', {
    schema: {
      tags: ['Transparency'],
      summary: 'Feed statistics',
      description:
        'Returns bounded aggregate statistics for the current feed including epoch weights, ' +
        'materialized feed-snapshot metrics, governance info, provenance, and optional Gini coefficient.',
      response: {
        200: {
          type: 'object',
          properties: {
            epoch: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                status: { type: 'string' },
                weights: {
                  type: 'object',
                  properties: {
                    recency: { type: 'number' },
                    engagement: { type: 'number' },
                    bridging: { type: 'number' },
                    source_diversity: { type: 'number' },
                    relevance: { type: 'number' },
                  },
                },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
            feed_stats: {
              type: 'object',
              properties: {
                total_posts_scored: {
                  type: 'integer',
                  description: 'Rows in the current materialized feed snapshot.',
                },
                unique_authors: { type: 'integer', description: 'Unique authors in the materialized feed snapshot.' },
                avg_bridging_score: { type: 'number' },
                avg_engagement_score: { type: 'number' },
                median_bridging_score: { type: 'number' },
                median_total_score: { type: 'number' },
              },
            },
            governance: {
              type: 'object',
              properties: {
                votes_this_epoch: { type: 'integer' },
              },
            },
            metrics: {
              type: 'object',
              nullable: true,
              description: 'Diversity and comparison metrics (available after first scoring run)',
              properties: {
                author_gini: { type: 'number', nullable: true, description: 'Author concentration (0=equal, 1=monopoly)' },
                vs_chronological_overlap: { type: 'number', nullable: true },
                vs_engagement_overlap: { type: 'number', nullable: true },
              },
            },
            stats_status: {
              type: 'object',
              description: 'Provenance for the bounded stats response.',
              properties: {
                source: { type: 'string', enum: ['scoring_run', 'fallback'] },
                degraded: { type: 'boolean' },
                computed_at: { type: 'string', format: 'date-time', nullable: true },
                run_id: { type: 'string', nullable: true },
                message: { type: 'string', nullable: true },
              },
              required: ['source', 'degraded'],
            },
          },
          required: ['epoch', 'feed_stats', 'governance', 'stats_status'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get current epoch
      const epochResult = await db.query(
        `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
      );

      if (epochResult.rows.length === 0) {
        return reply.code(500).send({
          error: 'NoActiveEpoch',
          message: 'No active governance epoch found',
        });
      }

      const epoch = epochResult.rows[0];
      const epochId = epoch.id;
      const [metrics, voteCount] = await Promise.all([
        readLatestEpochMetrics(epochId),
        readVoteCount(epochId),
      ]);

      const fallbackStats = metrics ? null : await buildFallbackFeedStats(epochId);
      const metricsAreComplete = metrics !== null &&
        metrics.metrics_source === 'current_feed' &&
        metrics.avg_engagement !== null &&
        metrics.median_total !== null;
      const statsStatusMessage = metrics
        ? metricsAreComplete
          ? null
          : 'Using legacy transparency metrics; some score-distribution fields may be incomplete until the next scoring run.'
        : 'Using degraded stats fallback; score-distribution metrics will populate after the next scoring run.';

      const response: FeedStats = {
        epoch: {
          id: epochId,
          status: epoch.status,
          weights: {
            recency: parseFloat(epoch.recency_weight),
            engagement: parseFloat(epoch.engagement_weight),
            bridging: parseFloat(epoch.bridging_weight),
            source_diversity: parseFloat(epoch.source_diversity_weight),
            relevance: parseFloat(epoch.relevance_weight),
          },
          created_at: epoch.created_at,
        },
        feed_stats: {
          total_posts_scored: metrics
            ? numericValue(metrics.posts_scored)
            : fallbackStats?.totalPostsScored ?? 0,
          unique_authors: metrics ? numericValue(metrics.unique_authors) : 0,
          avg_bridging_score: metrics ? numericValue(metrics.avg_bridging) : 0,
          avg_engagement_score: metrics ? numericValue(metrics.avg_engagement) : 0,
          median_bridging_score: metrics ? numericValue(metrics.median_bridging) : 0,
          median_total_score: metrics ? numericValue(metrics.median_total) : 0,
        },
        governance: {
          votes_this_epoch: voteCount,
        },
        stats_status: {
          source: metrics ? 'scoring_run' : 'fallback',
          degraded: !metricsAreComplete,
          computed_at: metrics
            ? isoDateTimeOrNull(metrics.computed_at)
            : isoDateTimeOrNull(fallbackStats?.computedAt ?? null),
          run_id: metrics ? metrics.run_id : fallbackStats?.runId ?? null,
          message: statsStatusMessage,
        },
      };

      // Add metrics if available
      if (metrics) {
        response.metrics = {
          author_gini: nullableNumericValue(metrics.author_gini),
          vs_chronological_overlap: nullableNumericValue(metrics.vs_chronological_overlap),
          vs_engagement_overlap: nullableNumericValue(metrics.vs_engagement_overlap),
        };
      }

      return reply.send(response);
    } catch (err) {
      logger.error({ err }, 'Error fetching feed stats');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'An error occurred while fetching feed statistics',
      });
    }
  });
}
