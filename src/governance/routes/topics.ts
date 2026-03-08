/**
 * Topic Catalog Routes
 *
 * GET /api/governance/topics
 *
 * Public endpoint returning active topics with current epoch's community weights.
 * Used by the voting UI to display available topics and their current preference levels.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { ErrorResponseSchema } from '../../lib/openapi.js';

/** Default weight for topics with no community votes. */
const DEFAULT_TOPIC_WEIGHT = 0.5;

/**
 * Register topic catalog routes with the Fastify application.
 *
 * @param app - Fastify instance
 */
export function registerTopicRoutes(app: FastifyInstance): void {
  /**
   * GET /api/governance/topics
   * Public endpoint - no auth required.
   * Returns all active topics with their current community-voted weights.
   */
  app.get('/api/governance/topics', {
    schema: {
      tags: ['Topics'],
      summary: 'List active topics',
      description:
        'Returns all active topics from the topic catalog with their current community-voted weights. ' +
        'Public endpoint — no authentication required.',
      response: {
        200: {
          type: 'object',
          properties: {
            topics: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slug: { type: 'string', description: 'Unique topic identifier' },
                  name: { type: 'string', description: 'Display name' },
                  description: { type: 'string', nullable: true },
                  parentSlug: { type: 'string', nullable: true, description: 'Parent topic slug for hierarchy' },
                  currentWeight: { type: 'number', description: 'Community-voted weight (0.0-1.0, default 0.5)' },
                },
              },
            },
            epochId: { type: 'integer', nullable: true, description: 'Active epoch ID' },
            voteCount: { type: 'integer', description: 'Number of topic weight voters this epoch' },
          },
          required: ['topics', 'voteCount'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get current epoch's topic weights
      const epochResult = await db.query(
        `SELECT id, topic_weights FROM governance_epochs
         WHERE status IN ('active', 'voting')
         ORDER BY id DESC LIMIT 1`
      );

      const epoch = epochResult.rows[0];
      const topicWeights = (epoch?.topic_weights as Record<string, number>) ?? {};

      // Get all active topics from catalog
      const topicsResult = await db.query(
        `SELECT slug, name, description, parent_slug
         FROM topic_catalog
         WHERE is_active = TRUE
         ORDER BY slug`
      );

      // Count topic weight votes for this epoch
      let voteCount = 0;
      if (epoch) {
        const countResult = await db.query(
          `SELECT COUNT(*)::int AS count FROM governance_votes
           WHERE epoch_id = $1
             AND topic_weight_votes IS NOT NULL
             AND topic_weight_votes != '{}'::jsonb`,
          [epoch.id]
        );
        voteCount = countResult.rows[0].count;
      }

      return reply.send({
        topics: topicsResult.rows.map((t: Record<string, unknown>) => ({
          slug: t.slug as string,
          name: t.name as string,
          description: (t.description as string) ?? null,
          parentSlug: (t.parent_slug as string) ?? null,
          currentWeight: topicWeights[t.slug as string] ?? DEFAULT_TOPIC_WEIGHT,
        })),
        epochId: epoch?.id ?? null,
        voteCount,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch topic catalog');
      return reply.code(500).send({
        error: 'TopicCatalogError',
        message: 'Failed to fetch topic catalog. Please try again.',
      });
    }
  });
}
