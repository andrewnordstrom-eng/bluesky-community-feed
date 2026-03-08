/**
 * Epochs Route
 *
 * GET /api/governance/epochs - List all epochs
 * GET /api/governance/epochs/:id - Get single epoch details
 * POST /api/governance/epochs/transition - Trigger epoch transition (admin only)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { ErrorResponseSchema, governanceSecurity } from '../../lib/openapi.js';
import { toEpochInfo, toContentRules, ContentRulesRow } from '../governance.types.js';
import { getAuthenticatedDid, SessionStoreUnavailableError } from '../auth.js';
import { triggerEpochTransition, forceEpochTransition, getCurrentEpochStatus } from '../epoch-manager.js';

const EpochListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['active', 'voting', 'closed']).optional(),
});

const EpochIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const ForceFlagSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'));

const TransitionQuerySchema = z.object({
  force: ForceFlagSchema.optional().default(false),
});

/** JSON Schemas for OpenAPI documentation. */
const EpochListQueryJsonSchema = zodToJsonSchema(
  z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['active', 'voting', 'closed']).optional(),
  }),
  { target: 'openApi3' }
);

const EpochIdParamsJsonSchema = zodToJsonSchema(EpochIdParamsSchema, { target: 'openApi3' });

/** Reusable epoch response shape for weights + content rules. */
const weightsSchema = {
  type: 'object' as const,
  properties: {
    recency: { type: 'number' as const },
    engagement: { type: 'number' as const },
    bridging: { type: 'number' as const },
    sourceDiversity: { type: 'number' as const },
    relevance: { type: 'number' as const },
  },
};

const contentRulesSchema = {
  type: 'object' as const,
  properties: {
    include_keywords: { type: 'array' as const, items: { type: 'string' as const } },
    exclude_keywords: { type: 'array' as const, items: { type: 'string' as const } },
  },
};

/**
 * Check if DID is an admin.
 */
function isAdmin(did: string): boolean {
  const adminDids = config.BOT_ADMIN_DIDS?.split(',').map((d) => d.trim()) ?? [];
  return adminDids.includes(did);
}

export function registerEpochsRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/epochs
   * Returns a list of all governance epochs.
   */
  app.get('/api/governance/epochs', {
    schema: {
      tags: ['Governance'],
      summary: 'List epochs',
      description: 'Returns a paginated list of governance epochs with weights, vote counts, and content rules. Optionally filter by status.',
      querystring: EpochListQueryJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            epochs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  status: { type: 'string' },
                  phase: { type: 'string' },
                  weights: weightsSchema,
                  vote_count: { type: 'integer' },
                  created_at: { type: 'string', format: 'date-time' },
                  closed_at: { type: 'string', format: 'date-time', nullable: true },
                  description: { type: 'string', nullable: true },
                  content_rules: contentRulesSchema,
                },
              },
            },
            total: { type: 'integer' },
          },
          required: ['epochs', 'total'],
        },
        400: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = EpochListQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }
    const { limit, status } = parseResult.data;

    let sql = `SELECT * FROM governance_epochs`;
    const params: unknown[] = [];

    if (status) {
      sql += ` WHERE status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY id DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(sql, params);

    const epochs = await Promise.all(
      result.rows.map(async (row) => {
        const epoch = toEpochInfo(row);
        const contentRules = toContentRules((row.content_rules as ContentRulesRow | null) ?? null);

        // Get actual vote count
        const voteCount = await db.query(
          `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
          [epoch.id]
        );

        return {
          id: epoch.id,
          status: epoch.status,
          phase: (row.phase as string | null) ?? (epoch.status === 'voting' ? 'voting' : 'running'),
          weights: epoch.weights,
          vote_count: parseInt(voteCount.rows[0].count),
          created_at: epoch.createdAt,
          closed_at: epoch.closedAt,
          description: epoch.description,
          content_rules: {
            include_keywords: contentRules.includeKeywords,
            exclude_keywords: contentRules.excludeKeywords,
          },
        };
      })
    );

    return reply.send({
      epochs,
      total: epochs.length,
    });
  });

  /**
   * GET /api/governance/epochs/current
   * Returns the current active epoch.
   */
  app.get('/api/governance/epochs/current', {
    schema: {
      tags: ['Governance'],
      summary: 'Get current epoch',
      description: 'Returns the current active or voting epoch with weights, vote/subscriber counts, voting schedule, and content rules.',
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: { type: 'string' },
            phase: { type: 'string' },
            weights: weightsSchema,
            vote_count: { type: 'integer' },
            subscriber_count: { type: 'integer', description: 'Active subscribers (potential voters)' },
            created_at: { type: 'string', format: 'date-time' },
            voting_started_at: { type: 'string', format: 'date-time', nullable: true },
            voting_ends_at: { type: 'string', format: 'date-time', nullable: true },
            voting_closed_at: { type: 'string', format: 'date-time', nullable: true },
            description: { type: 'string', nullable: true },
            content_rules: contentRulesSchema,
          },
          required: ['id', 'status', 'weights', 'vote_count', 'subscriber_count'],
        },
        404: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query(
      `SELECT * FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch found.',
      });
    }

    const epoch = toEpochInfo(result.rows[0]);
    const contentRules = toContentRules((result.rows[0].content_rules as ContentRulesRow | null) ?? null);

    // Get vote count
    const voteCount = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epoch.id]
    );

    // Get subscriber count (potential voters)
    const subscriberCount = await db.query(
      `SELECT COUNT(*) as count FROM subscribers WHERE is_active = TRUE`
    );

    return reply.send({
      id: epoch.id,
      status: epoch.status,
      phase: (result.rows[0].phase as string | null) ?? (epoch.status === 'voting' ? 'voting' : 'running'),
      weights: epoch.weights,
      vote_count: parseInt(voteCount.rows[0].count),
      subscriber_count: parseInt(subscriberCount.rows[0].count),
      created_at: epoch.createdAt,
      voting_started_at: result.rows[0].voting_started_at ?? null,
      voting_ends_at: result.rows[0].voting_ends_at ?? null,
      voting_closed_at: result.rows[0].voting_closed_at ?? null,
      description: epoch.description,
      content_rules: {
        include_keywords: contentRules.includeKeywords,
        exclude_keywords: contentRules.excludeKeywords,
      },
    });
  });

  /**
   * GET /api/governance/epochs/:id
   * Returns details for a specific epoch.
   */
  app.get('/api/governance/epochs/:id', {
    schema: {
      tags: ['Governance'],
      summary: 'Get epoch by ID',
      description: 'Returns full details for a specific epoch including weights, vote statistics (averages and ranges), and content rules.',
      params: EpochIdParamsJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: { type: 'string' },
            phase: { type: 'string' },
            weights: weightsSchema,
            vote_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            closed_at: { type: 'string', format: 'date-time', nullable: true },
            description: { type: 'string', nullable: true },
            content_rules: contentRulesSchema,
            vote_statistics: {
              type: 'object',
              nullable: true,
              description: 'Aggregate vote statistics (null if no votes)',
              properties: {
                average: weightsSchema,
                range: {
                  type: 'object',
                  properties: {
                    recency: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
                    engagement: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
                    bridging: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
                    sourceDiversity: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
                    relevance: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
                  },
                },
              },
            },
          },
          required: ['id', 'status', 'weights', 'vote_count'],
        },
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = EpochIdParamsSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid epoch id',
        details: parseResult.error.issues,
      });
    }
    const { id: epochId } = parseResult.data;

    const result = await db.query(`SELECT * FROM governance_epochs WHERE id = $1`, [epochId]);

    if (result.rows.length === 0) {
      return reply.code(404).send({
        error: 'EpochNotFound',
        message: `Epoch ${epochId} not found.`,
      });
    }

    const epoch = toEpochInfo(result.rows[0]);
    const contentRules = toContentRules((result.rows[0].content_rules as ContentRulesRow | null) ?? null);

    // Get vote count
    const voteCount = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epochId]
    );

    // Get vote distribution (aggregate stats, not individual votes for privacy)
    const voteStats = await db.query(
      `SELECT
        AVG(recency_weight) as avg_recency,
        AVG(engagement_weight) as avg_engagement,
        AVG(bridging_weight) as avg_bridging,
        AVG(source_diversity_weight) as avg_source_diversity,
        AVG(relevance_weight) as avg_relevance,
        MIN(recency_weight) as min_recency,
        MAX(recency_weight) as max_recency,
        MIN(engagement_weight) as min_engagement,
        MAX(engagement_weight) as max_engagement,
        MIN(bridging_weight) as min_bridging,
        MAX(bridging_weight) as max_bridging,
        MIN(source_diversity_weight) as min_source_diversity,
        MAX(source_diversity_weight) as max_source_diversity,
        MIN(relevance_weight) as min_relevance,
        MAX(relevance_weight) as max_relevance
       FROM governance_votes
       WHERE epoch_id = $1`,
      [epochId]
    );

    const stats = voteStats.rows[0];

    return reply.send({
      id: epoch.id,
      status: epoch.status,
      weights: epoch.weights,
      vote_count: parseInt(voteCount.rows[0].count),
      created_at: epoch.createdAt,
      closed_at: epoch.closedAt,
      description: epoch.description,
      phase: (result.rows[0].phase as string | null) ?? (epoch.status === 'voting' ? 'voting' : 'running'),
      content_rules: {
        include_keywords: contentRules.includeKeywords,
        exclude_keywords: contentRules.excludeKeywords,
      },
      vote_statistics:
        parseInt(voteCount.rows[0].count) > 0
          ? {
              average: {
                recency: parseFloat(stats.avg_recency) || 0,
                engagement: parseFloat(stats.avg_engagement) || 0,
                bridging: parseFloat(stats.avg_bridging) || 0,
                sourceDiversity: parseFloat(stats.avg_source_diversity) || 0,
                relevance: parseFloat(stats.avg_relevance) || 0,
              },
              range: {
                recency: {
                  min: parseFloat(stats.min_recency) || 0,
                  max: parseFloat(stats.max_recency) || 0,
                },
                engagement: {
                  min: parseFloat(stats.min_engagement) || 0,
                  max: parseFloat(stats.max_engagement) || 0,
                },
                bridging: {
                  min: parseFloat(stats.min_bridging) || 0,
                  max: parseFloat(stats.max_bridging) || 0,
                },
                sourceDiversity: {
                  min: parseFloat(stats.min_source_diversity) || 0,
                  max: parseFloat(stats.max_source_diversity) || 0,
                },
                relevance: {
                  min: parseFloat(stats.min_relevance) || 0,
                  max: parseFloat(stats.max_relevance) || 0,
                },
              },
            }
          : null,
    });
  });

  /**
   * POST /api/governance/epochs/transition
   * Triggers epoch transition (admin only).
   * Requires valid session with DID in BOT_ADMIN_DIDS.
   *
   * Query params:
   * - force=true: Skip vote count check (for testing)
   */
  app.post('/api/governance/epochs/transition', {
    schema: {
      tags: ['Admin'],
      summary: 'Trigger epoch transition',
      description:
        'Triggers a governance epoch transition (admin only). Tallies votes, creates a new epoch with updated weights. ' +
        'Use force=true to skip vote count validation.',
      security: governanceSecurity,
      querystring: {
        type: 'object',
        properties: {
          force: { type: 'boolean', default: false, description: 'Skip vote count check (for testing)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            newEpochId: { type: 'integer' },
            forced: { type: 'boolean' },
            previousEpochId: { type: 'integer' },
            voteCount: { type: 'integer' },
          },
          required: ['success', 'newEpochId', 'forced'],
        },
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Admin auth check
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      logger.warn({ did: requesterDid }, 'Non-admin attempted to trigger epoch transition');
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required for epoch transitions',
      });
    }

    const queryParseResult = TransitionQuerySchema.safeParse(request.query);
    if (!queryParseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid query parameters',
        details: queryParseResult.error.issues,
      });
    }
    const { force } = queryParseResult.data;

    try {
      // Get current status first
      const status = await getCurrentEpochStatus();
      if (!status) {
        return reply.code(400).send({
          error: 'NoActiveEpoch',
          message: 'No active epoch to transition',
        });
      }

      if (force) {
        logger.warn(
          { adminDid: requesterDid, epochId: status.epochId, voteCount: status.voteCount },
          'Admin forcing epoch transition'
        );
        const newEpochId = await forceEpochTransition();
        return reply.send({
          success: true,
          newEpochId,
          forced: true,
          previousEpochId: status.epochId,
          voteCount: status.voteCount,
        });
      }

      const result = await triggerEpochTransition();
      if (!result.success) {
        return reply.code(400).send({
          error: 'TransitionFailed',
          message: result.error,
          currentStatus: status,
        });
      }

      logger.info(
        { adminDid: requesterDid, newEpochId: result.newEpochId },
        'Admin triggered epoch transition'
      );

      return reply.send({
        success: true,
        newEpochId: result.newEpochId,
        forced: false,
        previousEpochId: status.epochId,
        voteCount: status.voteCount,
      });
    } catch (err) {
      logger.error({ err, adminDid: requesterDid }, 'Failed to trigger epoch transition');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'Failed to trigger epoch transition',
      });
    }
  });
}
