/**
 * Debug Routes
 *
 * Endpoints for debugging and monitoring feed health.
 * These help verify the scoring pipeline is using governance weights correctly.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { requireAdmin } from '../../auth/admin.js';
import { config } from '../../config.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';
import {
  checkContentRules,
  filterPosts,
  getCurrentContentRules,
} from '../../governance/content-filter.js';

export function registerDebugRoutes(app: FastifyInstance): void {
  // Always require admin auth — debug endpoints expose epoch data, vote counts,
  // subscriber counts, and sample post scores. Even in dev/staging, they should
  // not be public in case those environments contain real data.
  const preHandler = requireAdmin;

  /**
   * GET /api/debug/feed-health
   * Returns comprehensive feed health information including:
   * - Current epoch and weights
   * - Vote count
   * - Last scoring run timestamp
   * - Sample post scores
   */
  app.get('/api/debug/feed-health', {
    preHandler,
    schema: {
      tags: ['Admin'],
      summary: 'Feed health debug',
      description:
        'Comprehensive feed health check: current epoch, active weights, vote count, subscriber count, ' +
        'last scoring run, Redis feed size, and sample top-3 post scores with full decomposition.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            current_epoch: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                status: { type: 'string' },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
            active_weights: {
              type: 'object',
              properties: {
                recency: { type: 'number' },
                engagement: { type: 'number' },
                bridging: { type: 'number' },
                source_diversity: { type: 'number' },
                relevance: { type: 'number' },
              },
            },
            votes_this_epoch: { type: 'integer' },
            subscriber_count: { type: 'integer' },
            last_scoring_run: { type: 'string', format: 'date-time', nullable: true },
            feed_size: { type: 'integer' },
            sample_post_scores: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string' },
                  total_score: { type: 'number' },
                  scores: { type: 'object', additionalProperties: true },
                  weights_used: { type: 'object', additionalProperties: true },
                  scored_at: { type: 'string', format: 'date-time' },
                },
              },
            },
            weights_source: { type: 'string' },
          },
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get current active epoch
      const epoch = await db.query(
        `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
      );

      if (epoch.rows.length === 0) {
        return reply.send({
          error: 'NoActiveEpoch',
          message: 'No active governance epoch found',
        });
      }

      const currentEpoch = epoch.rows[0];

      // Get vote count for current epoch
      const votes = await db.query(
        `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
        [currentEpoch.id]
      );

      // Get last scoring run timestamp
      const lastScore = await db.query(
        `SELECT MAX(scored_at) as last_run FROM post_scores WHERE epoch_id = $1`,
        [currentEpoch.id]
      );

      // Get sample scored posts (top 3 by score)
      const sample = await db.query(
        `SELECT
          post_uri,
          total_score,
          recency_score,
          engagement_score,
          bridging_score,
          source_diversity_score,
          relevance_score,
          recency_weight,
          engagement_weight,
          bridging_weight,
          source_diversity_weight,
          relevance_weight,
          scored_at
        FROM post_scores
        WHERE epoch_id = $1
        ORDER BY total_score DESC
        LIMIT 3`,
        [currentEpoch.id]
      );

      // Get feed size from Redis
      const feedSize = await redis.zcard('feed:current');

      // Get subscriber count
      const subscribers = await db.query(
        `SELECT COUNT(*) as count FROM subscribers WHERE is_active = TRUE`
      );

      return reply.send({
        current_epoch: {
          id: currentEpoch.id,
          status: currentEpoch.status,
          created_at: currentEpoch.created_at,
        },
        active_weights: {
          recency: currentEpoch.recency_weight,
          engagement: currentEpoch.engagement_weight,
          bridging: currentEpoch.bridging_weight,
          source_diversity: currentEpoch.source_diversity_weight,
          relevance: currentEpoch.relevance_weight,
        },
        votes_this_epoch: parseInt(votes.rows[0].count),
        subscriber_count: parseInt(subscribers.rows[0].count),
        last_scoring_run: lastScore.rows[0]?.last_run || null,
        feed_size: feedSize,
        sample_post_scores: sample.rows.map((row) => ({
          uri: row.post_uri,
          total_score: parseFloat(row.total_score),
          scores: {
            recency: parseFloat(row.recency_score),
            engagement: parseFloat(row.engagement_score),
            bridging: parseFloat(row.bridging_score),
            source_diversity: parseFloat(row.source_diversity_score),
            relevance: parseFloat(row.relevance_score),
          },
          weights_used: {
            recency: parseFloat(row.recency_weight),
            engagement: parseFloat(row.engagement_weight),
            bridging: parseFloat(row.bridging_weight),
            source_diversity: parseFloat(row.source_diversity_weight),
            relevance: parseFloat(row.relevance_weight),
          },
          scored_at: row.scored_at,
        })),
        weights_source: `governance_epochs.id=${currentEpoch.id}`,
      });
    } catch (err) {
      return reply.code(500).send({
        error: 'DebugError',
        message: 'Failed to fetch debug information',
      });
    }
  });

  /**
   * GET /api/debug/scoring-weights
   * Returns just the current scoring weights (simpler than feed-health).
   */
  app.get('/api/debug/scoring-weights', {
    preHandler,
    schema: {
      tags: ['Admin'],
      summary: 'Current scoring weights',
      description: 'Returns the current active governance epoch weights used by the scoring pipeline.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            epoch_id: { type: 'integer' },
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
            source: { type: 'string' },
            last_updated: { type: 'string', format: 'date-time' },
          },
          required: ['epoch_id', 'weights', 'source', 'last_updated'],
        },
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const epoch = await db.query(
        `SELECT id, recency_weight, engagement_weight, bridging_weight,
                source_diversity_weight, relevance_weight, created_at
         FROM governance_epochs
         WHERE status = 'active'
         ORDER BY id DESC LIMIT 1`
      );

      if (epoch.rows.length === 0) {
        return reply.code(404).send({
          error: 'NoActiveEpoch',
          message: 'No active governance epoch found',
        });
      }

      const e = epoch.rows[0];
      return reply.send({
        epoch_id: e.id,
        weights: {
          recency: parseFloat(e.recency_weight),
          engagement: parseFloat(e.engagement_weight),
          bridging: parseFloat(e.bridging_weight),
          source_diversity: parseFloat(e.source_diversity_weight),
          relevance: parseFloat(e.relevance_weight),
        },
        source: 'governance_epochs table',
        last_updated: e.created_at,
      });
    } catch (err) {
      return reply.code(500).send({
        error: 'DebugError',
        message: 'Failed to fetch scoring weights',
      });
    }
  });

  /**
   * GET /api/debug/content-rules
   * Returns current active content rules from cache/DB.
   */
  app.get('/api/debug/content-rules', {
    preHandler,
    schema: {
      tags: ['Admin'],
      summary: 'Active content rules',
      description: 'Returns the currently active keyword include/exclude content rules from cache or DB.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            rules: {
              type: 'object',
              properties: {
                includeKeywords: { type: 'array', items: { type: 'string' } },
                excludeKeywords: { type: 'array', items: { type: 'string' } },
              },
            },
            hasActiveRules: { type: 'boolean' },
          },
          required: ['rules', 'hasActiveRules'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rules = await getCurrentContentRules();
      return reply.send({
        rules,
        hasActiveRules: rules.includeKeywords.length > 0 || rules.excludeKeywords.length > 0,
      });
    } catch (err) {
      return reply.code(500).send({
        error: 'DebugError',
        message: 'Failed to fetch content rules',
      });
    }
  });

  /**
   * POST /api/debug/test-content-filter
   * Tests content filtering with provided rules and sample posts.
   *
   * Body:
   * - rules: { includeKeywords: string[], excludeKeywords: string[] }
   * - posts: { uri: string, text: string | null }[]
   *
   * OR for single text check:
   * - rules: { includeKeywords: string[], excludeKeywords: string[] }
   * - text: string
   */
  /** JSON Schema for OpenAPI documentation. */
  const TestFilterSchema = z.object({
    rules: z.object({
      includeKeywords: z.array(z.string()).default([]),
      excludeKeywords: z.array(z.string()).default([]),
    }),
    posts: z
      .array(
        z.object({
          uri: z.string(),
          text: z.string().nullable(),
        })
      )
      .optional(),
    text: z.string().optional(),
  });

  const TestFilterJsonSchema = zodToJsonSchema(TestFilterSchema, { target: 'jsonSchema7' });

  app.post('/api/debug/test-content-filter', {
    preHandler,
    schema: {
      tags: ['Admin'],
      summary: 'Test content filter',
      description:
        'Tests content filtering with provided rules against sample posts or a single text string. ' +
        'Returns which posts pass or are filtered and why.',
      security: adminSecurity,
      body: TestFilterJsonSchema,
      response: {
        200: {
          type: 'object',
          description: 'Result varies by input mode (single text or batch posts)',
          properties: {
            text: { type: 'string' },
            rules: { type: 'object', additionalProperties: true },
            result: { type: 'object', additionalProperties: true },
            input_count: { type: 'integer' },
            passed_count: { type: 'integer' },
            filtered_count: { type: 'integer' },
            passed: { type: 'array' },
            filtered: { type: 'array' },
          },
        },
        400: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = TestFilterSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { rules, posts, text } = parseResult.data;

    // Single text check
    if (text !== undefined) {
      const result = checkContentRules(text, rules);
      return reply.send({
        text,
        rules,
        result,
      });
    }

    // Batch post filtering
    if (posts && posts.length > 0) {
      const filterResult = filterPosts(posts, rules);
      return reply.send({
        rules,
        input_count: posts.length,
        passed_count: filterResult.passed.length,
        filtered_count: filterResult.filtered.length,
        passed: filterResult.passed,
        filtered: filterResult.filtered.map((f) => ({
          uri: f.post.uri,
          text: f.post.text,
          reason: f.reason,
          matchedKeyword: f.matchedKeyword,
        })),
      });
    }

    return reply.code(400).send({
      error: 'ValidationError',
      message: 'Either "text" or "posts" must be provided',
    });
  });
}
