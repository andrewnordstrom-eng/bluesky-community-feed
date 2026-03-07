/**
 * Debug Routes
 *
 * Endpoints for debugging and monitoring feed health.
 * These help verify the scoring pipeline is using governance weights correctly.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { requireAdmin } from '../../auth/admin.js';
import { config } from '../../config.js';
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
  app.get('/api/debug/feed-health', { preHandler }, async (_request: FastifyRequest, reply: FastifyReply) => {
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
  app.get('/api/debug/scoring-weights', { preHandler }, async (_request: FastifyRequest, reply: FastifyReply) => {
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
  app.get('/api/debug/content-rules', { preHandler }, async (_request: FastifyRequest, reply: FastifyReply) => {
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

  app.post('/api/debug/test-content-filter', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
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
