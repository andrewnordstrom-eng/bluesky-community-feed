/**
 * Weights Route
 *
 * GET /api/governance/weights - Current active epoch weights
 * GET /api/governance/weights/history - All epochs with weights
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { ErrorResponseSchema } from '../../lib/openapi.js';
import { toEpochInfo } from '../governance.types.js';

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const CompareQuerySchema = z.object({
  epoch1: z.coerce.number().int().positive(),
  epoch2: z.coerce.number().int().positive(),
});

/** JSON Schemas for OpenAPI documentation (no effects — safe for Ajv). */
const HistoryQueryJsonSchema = zodToJsonSchema(HistoryQuerySchema, { target: 'jsonSchema7' });
const CompareQueryJsonSchema = zodToJsonSchema(CompareQuerySchema, { target: 'jsonSchema7' });

/** Reusable weights object schema for responses. */
const weightsObjectSchema = {
  type: 'object' as const,
  properties: {
    recency: { type: 'number' as const },
    engagement: { type: 'number' as const },
    bridging: { type: 'number' as const },
    sourceDiversity: { type: 'number' as const },
    relevance: { type: 'number' as const },
  },
};

export function registerWeightsRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/weights
   * Returns the current active epoch's weights.
   */
  app.get('/api/governance/weights', {
    schema: {
      tags: ['Governance'],
      summary: 'Get current weights',
      description: 'Returns the active epoch\'s governance weights, vote count, and metadata.',
      response: {
        200: {
          type: 'object',
          properties: {
            epoch_id: { type: 'integer', description: 'Active epoch ID' },
            status: { type: 'string', description: 'Epoch status' },
            weights: weightsObjectSchema,
            vote_count: { type: 'integer', description: 'Number of votes in this epoch' },
            created_at: { type: 'string', format: 'date-time' },
            description: { type: 'string', nullable: true },
          },
          required: ['epoch_id', 'status', 'weights', 'vote_count'],
        },
        404: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query(
      `SELECT * FROM governance_epochs
       WHERE status = 'active'
       ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch found.',
      });
    }

    const epoch = toEpochInfo(result.rows[0]);

    // Get vote count for this epoch
    const voteCount = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epoch.id]
    );

    return reply.send({
      epoch_id: epoch.id,
      status: epoch.status,
      weights: epoch.weights,
      vote_count: parseInt(voteCount.rows[0].count),
      created_at: epoch.createdAt,
      description: epoch.description,
    });
  });

  /**
   * GET /api/governance/weights/history
   * Returns all epochs with their weights (for timeline visualization).
   */
  app.get('/api/governance/weights/history', {
    schema: {
      tags: ['Governance'],
      summary: 'Weight history',
      description: 'Returns all epochs with their weights, ordered newest first. Useful for timeline visualization of governance changes.',
      querystring: HistoryQueryJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            epochs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  epoch_id: { type: 'integer' },
                  status: { type: 'string' },
                  weights: weightsObjectSchema,
                  vote_count: { type: 'integer' },
                  created_at: { type: 'string', format: 'date-time' },
                  closed_at: { type: 'string', format: 'date-time', nullable: true },
                  description: { type: 'string', nullable: true },
                },
              },
            },
            total: { type: 'integer', description: 'Number of epochs returned' },
          },
          required: ['epochs', 'total'],
        },
        400: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = HistoryQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }

    const { limit } = parseResult.data;

    const result = await db.query(
      `SELECT * FROM governance_epochs
       ORDER BY id DESC
       LIMIT $1`,
      [limit]
    );

    const epochs = await Promise.all(
      result.rows.map(async (row) => {
        const epoch = toEpochInfo(row);

        // Get actual vote count from governance_votes table
        const voteCount = await db.query(
          `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
          [epoch.id]
        );

        return {
          epoch_id: epoch.id,
          status: epoch.status,
          weights: epoch.weights,
          vote_count: parseInt(voteCount.rows[0].count),
          created_at: epoch.createdAt,
          closed_at: epoch.closedAt,
          description: epoch.description,
        };
      })
    );

    return reply.send({
      epochs,
      total: epochs.length,
    });
  });

  /**
   * GET /api/governance/weights/compare
   * Compare weights between two epochs.
   */
  app.get('/api/governance/weights/compare', {
    schema: {
      tags: ['Governance'],
      summary: 'Compare epoch weights',
      description: 'Compare weights between two epochs, showing the difference for each component.',
      querystring: CompareQueryJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            epoch1: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                weights: weightsObjectSchema,
                status: { type: 'string' },
              },
            },
            epoch2: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                weights: weightsObjectSchema,
                status: { type: 'string' },
              },
            },
            difference: {
              type: 'object',
              description: 'Weight differences (epoch2 − epoch1)',
              properties: {
                recency: { type: 'number' },
                engagement: { type: 'number' },
                bridging: { type: 'number' },
                sourceDiversity: { type: 'number' },
                relevance: { type: 'number' },
              },
            },
          },
          required: ['epoch1', 'epoch2', 'difference'],
        },
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CompareQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }

    const { epoch1: epoch1Id, epoch2: epoch2Id } = parseResult.data;

    if (epoch1Id === epoch2Id) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'epoch1 and epoch2 must be different values',
      });
    }

    const result = await db.query(
      `SELECT * FROM governance_epochs WHERE id IN ($1, $2) ORDER BY id`,
      [epoch1Id, epoch2Id]
    );

    if (result.rows.length !== 2) {
      return reply.code(404).send({
        error: 'EpochNotFound',
        message: 'One or both epochs not found.',
      });
    }

    const epoch1 = toEpochInfo(result.rows.find((r) => r.id === epoch1Id));
    const epoch2 = toEpochInfo(result.rows.find((r) => r.id === epoch2Id));

    // Calculate differences
    const diff = {
      recency: epoch2.weights.recency - epoch1.weights.recency,
      engagement: epoch2.weights.engagement - epoch1.weights.engagement,
      bridging: epoch2.weights.bridging - epoch1.weights.bridging,
      sourceDiversity: epoch2.weights.sourceDiversity - epoch1.weights.sourceDiversity,
      relevance: epoch2.weights.relevance - epoch1.weights.relevance,
    };

    return reply.send({
      epoch1: {
        id: epoch1.id,
        weights: epoch1.weights,
        status: epoch1.status,
      },
      epoch2: {
        id: epoch2.id,
        weights: epoch2.weights,
        status: epoch2.status,
      },
      difference: diff,
    });
  });
}
