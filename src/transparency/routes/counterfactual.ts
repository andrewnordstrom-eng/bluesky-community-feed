/**
 * Counterfactual Route
 *
 * GET /api/transparency/counterfactual
 *
 * "What if the weights were different?"
 *
 * Uses stored raw scores to recalculate rankings with alternate weights.
 * No need to re-run the scoring pipeline — just arithmetic on stored values.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { ErrorResponseSchema } from '../../lib/openapi.js';
import type { CounterfactualResult, CounterfactualPost } from '../transparency.types.js';

// Query params schema - weights must sum to 1.0
const CounterfactualQuerySchema = z.object({
  recency: z.coerce.number().min(0).max(1).default(0.2),
  engagement: z.coerce.number().min(0).max(1).default(0.2),
  bridging: z.coerce.number().min(0).max(1).default(0.2),
  source_diversity: z.coerce.number().min(0).max(1).default(0.2),
  relevance: z.coerce.number().min(0).max(1).default(0.2),
  limit: z.coerce.number().min(1).max(500).default(50),
});

/** JSON Schema for OpenAPI documentation. */
const CounterfactualQueryJsonSchema = zodToJsonSchema(CounterfactualQuerySchema, { target: 'openApi3' });

interface CurrentScoringRunValue {
  run_id?: unknown;
  epoch_id?: unknown;
}

async function getCurrentScoringRunScope(): Promise<{ runId: string; epochId: number } | null> {
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
  };
}

export function registerCounterfactualRoute(app: FastifyInstance): void {
  app.get(
    '/api/transparency/counterfactual',
    {
      schema: {
        tags: ['Transparency'],
        summary: 'Counterfactual rankings',
        description:
          '"What if the weights were different?" Recalculates rankings using stored raw scores with alternate weights. ' +
          'Weights must sum to 1.0.',
        querystring: CounterfactualQueryJsonSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              alternate_weights: {
                type: 'object',
                properties: {
                  recency: { type: 'number' },
                  engagement: { type: 'number' },
                  bridging: { type: 'number' },
                  source_diversity: { type: 'number' },
                  relevance: { type: 'number' },
                },
              },
              current_weights: {
                type: 'object',
                properties: {
                  recency: { type: 'number' },
                  engagement: { type: 'number' },
                  bridging: { type: 'number' },
                  source_diversity: { type: 'number' },
                  relevance: { type: 'number' },
                },
              },
              posts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    post_uri: { type: 'string' },
                    original_score: { type: 'number' },
                    original_rank: { type: 'integer' },
                    counterfactual_score: { type: 'number' },
                    counterfactual_rank: { type: 'integer' },
                    rank_delta: { type: 'integer', description: 'Positive = moved up with alternate weights' },
                  },
                },
              },
              summary: {
                type: 'object',
                properties: {
                  total_posts: { type: 'integer' },
                  posts_moved_up: { type: 'integer' },
                  posts_moved_down: { type: 'integer' },
                  posts_unchanged: { type: 'integer' },
                  max_rank_change: { type: 'integer' },
                  avg_rank_change: { type: 'number' },
                },
              },
            },
            required: ['alternate_weights', 'current_weights', 'posts', 'summary'],
          },
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Parse and validate query params
      const parseResult = CounterfactualQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'ValidationError',
          message: 'Invalid query parameters',
          details: parseResult.error.issues,
        });
      }

      const { recency, engagement, bridging, source_diversity, relevance, limit } =
        parseResult.data;

      // Validate weights sum to approximately 1.0
      const sum = recency + engagement + bridging + source_diversity + relevance;
      if (Math.abs(sum - 1.0) > 0.01) {
        return reply.code(400).send({
          error: 'ValidationError',
          message: `Weights must sum to 1.0 (got ${sum.toFixed(3)})`,
        });
      }

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
        const runScope = await getCurrentScoringRunScope();

        // Fetch top posts with raw scores from current epoch
        // We fetch more than limit to compare rankings properly
        const fetchLimit = Math.min(limit * 2, 1000);

        const postsParams: unknown[] = [epochId];
        let runScopeClause = '';
        if (runScope && runScope.epochId === epochId) {
          postsParams.push(runScope.runId);
          runScopeClause = `AND component_details->>'run_id' = $${postsParams.length}`;
        }
        postsParams.push(fetchLimit);

        const postsResult = await db.query(
          `
          SELECT
            post_uri,
            recency_score,
            engagement_score,
            bridging_score,
            source_diversity_score,
            relevance_score,
            total_score
          FROM post_scores
          WHERE epoch_id = $1
            ${runScopeClause}
          ORDER BY total_score DESC
          LIMIT $${postsParams.length}
          `,
          postsParams
        );

        if (postsResult.rows.length === 0) {
          return reply.send({
            alternate_weights: { recency, engagement, bridging, source_diversity, relevance },
            current_weights: {
              recency: parseFloat(epoch.recency_weight),
              engagement: parseFloat(epoch.engagement_weight),
              bridging: parseFloat(epoch.bridging_weight),
              source_diversity: parseFloat(epoch.source_diversity_weight),
              relevance: parseFloat(epoch.relevance_weight),
            },
            posts: [],
            summary: {
              total_posts: 0,
              posts_moved_up: 0,
              posts_moved_down: 0,
              posts_unchanged: 0,
              max_rank_change: 0,
              avg_rank_change: 0,
            },
          });
        }

        // Calculate counterfactual scores using stored raw scores
        const postsWithCounterfactual = postsResult.rows.map((row, originalRank) => ({
          post_uri: row.post_uri,
          original_score: parseFloat(row.total_score),
          original_rank: originalRank + 1,
          counterfactual_score:
            parseFloat(row.recency_score) * recency +
            parseFloat(row.engagement_score) * engagement +
            parseFloat(row.bridging_score) * bridging +
            parseFloat(row.source_diversity_score) * source_diversity +
            parseFloat(row.relevance_score) * relevance,
        }));

        // Sort by counterfactual score to get new ranking
        const sortedByCounterfactual = [...postsWithCounterfactual].sort(
          (a, b) => b.counterfactual_score - a.counterfactual_score
        );

        // Assign counterfactual ranks
        const counterfactualRankMap = new Map<string, number>();
        sortedByCounterfactual.forEach((post, index) => {
          counterfactualRankMap.set(post.post_uri, index + 1);
        });

        // Build result with rank deltas
        const posts: CounterfactualPost[] = postsWithCounterfactual
          .slice(0, limit)
          .map((post) => {
            const counterfactual_rank = counterfactualRankMap.get(post.post_uri)!;
            return {
              post_uri: post.post_uri,
              original_score: post.original_score,
              original_rank: post.original_rank,
              counterfactual_score: post.counterfactual_score,
              counterfactual_rank,
              rank_delta: post.original_rank - counterfactual_rank,
            };
          });

        // Calculate summary statistics
        let movedUp = 0;
        let movedDown = 0;
        let unchanged = 0;
        let maxChange = 0;
        let totalChange = 0;

        for (const post of posts) {
          if (post.rank_delta > 0) movedUp++;
          else if (post.rank_delta < 0) movedDown++;
          else unchanged++;

          const absChange = Math.abs(post.rank_delta);
          maxChange = Math.max(maxChange, absChange);
          totalChange += absChange;
        }

        const result: CounterfactualResult = {
          alternate_weights: { recency, engagement, bridging, source_diversity, relevance },
          current_weights: {
            recency: parseFloat(epoch.recency_weight),
            engagement: parseFloat(epoch.engagement_weight),
            bridging: parseFloat(epoch.bridging_weight),
            source_diversity: parseFloat(epoch.source_diversity_weight),
            relevance: parseFloat(epoch.relevance_weight),
          },
          posts,
          summary: {
            total_posts: posts.length,
            posts_moved_up: movedUp,
            posts_moved_down: movedDown,
            posts_unchanged: unchanged,
            max_rank_change: maxChange,
            avg_rank_change: posts.length > 0 ? totalChange / posts.length : 0,
          },
        };

        return reply.send(result);
      } catch (err) {
        logger.error({ err }, 'Error calculating counterfactual');
        return reply.code(500).send({
          error: 'InternalError',
          message: 'An error occurred while calculating counterfactual rankings',
        });
      }
    }
  );
}
