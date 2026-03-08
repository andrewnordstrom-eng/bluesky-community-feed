/**
 * Audit Log Route
 *
 * GET /api/transparency/audit
 *
 * Returns paginated list of governance audit log entries.
 * The audit log is append-only and provides a transparent record
 * of all governance actions.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { ErrorResponseSchema } from '../../lib/openapi.js';
import type { AuditLogResponse, AuditLogEntry } from '../transparency.types.js';

const VOTE_ACTIONS = new Set(['vote_cast', 'vote_updated']);

const AuditLogQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  action: z.string().optional(),
  epoch_id: z.coerce.number().optional(),
});

/** JSON Schema for OpenAPI documentation. */
const AuditLogQueryJsonSchema = zodToJsonSchema(AuditLogQuerySchema, { target: 'openApi3' });

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function keywordCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function redactDetails(
  action: string,
  details: unknown,
  epochId: number | null
): Record<string, unknown> {
  const safeDetails = asRecord(details) ?? {};
  if (!VOTE_ACTIONS.has(action)) {
    return safeDetails;
  }

  const contentVote = asRecord(safeDetails.content_vote);
  const includeKeywordCount = keywordCount(contentVote?.include_keywords);
  const excludeKeywordCount = keywordCount(contentVote?.exclude_keywords);
  const hasWeights = asRecord(safeDetails.weights) !== null || asRecord(safeDetails.original_weights) !== null;

  const summary: Record<string, unknown> = {
    hasWeights,
    hasContentVote: includeKeywordCount > 0 || excludeKeywordCount > 0,
    includeKeywordCount,
    excludeKeywordCount,
  };

  if (typeof epochId === 'number') {
    summary.epochId = epochId;
  }

  return summary;
}

export function registerAuditLogRoute(app: FastifyInstance): void {
  app.get('/api/transparency/audit', {
    schema: {
      tags: ['Transparency'],
      summary: 'Governance audit log',
      description:
        'Returns a paginated, append-only audit log of all governance actions. ' +
        'Vote details are redacted to preserve voter privacy (shows counts, not specific votes).',
      querystring: AuditLogQueryJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  action: { type: 'string', description: 'Action type (e.g. vote_cast, epoch_created)' },
                  actor_did: { type: 'string', nullable: true, description: 'Redacted for privacy' },
                  epoch_id: { type: 'integer', nullable: true },
                  details: { type: 'object', description: 'Action-specific details (vote details redacted)' },
                  created_at: { type: 'string', format: 'date-time' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                has_more: { type: 'boolean' },
              },
              required: ['total', 'limit', 'offset', 'has_more'],
            },
          },
          required: ['entries', 'pagination'],
        },
        400: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = AuditLogQuerySchema.safeParse(request.query);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }

    const { limit, offset, action, epoch_id } = parseResult.data;

    try {
      // Build query with optional filters
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (action) {
        conditions.push(`action = $${paramIndex++}`);
        params.push(action);
      }

      if (epoch_id !== undefined) {
        conditions.push(`epoch_id = $${paramIndex++}`);
        params.push(epoch_id);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM governance_audit_log ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total, 10);

      // Get entries with pagination
      params.push(limit, offset);
      const entriesResult = await db.query(
        `SELECT id, action, actor_did, epoch_id, details, created_at
         FROM governance_audit_log
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        params
      );

      const entries: AuditLogEntry[] = entriesResult.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor_did: null,
        epoch_id: row.epoch_id,
        details: redactDetails(row.action, row.details, row.epoch_id),
        created_at: row.created_at,
      }));

      const response: AuditLogResponse = {
        entries,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + entries.length < total,
        },
      };

      return reply.send(response);
    } catch (err) {
      logger.error({ err }, 'Error fetching audit log');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'An error occurred while fetching the audit log',
      });
    }
  });
}
