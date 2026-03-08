/**
 * Admin Audit Log Routes
 *
 * GET /api/admin/audit-log - View recent admin/system actions
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';

const AuditLogQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  action: z.string().optional(),
  actor: z.string().optional(),
});

/** JSON Schema for OpenAPI documentation. */
const AuditLogQueryJsonSchema = zodToJsonSchema(AuditLogQuerySchema, { target: 'openApi3' });

export function registerAuditLogRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/audit-log
   * View recent admin/system actions with optional filters
   */
  app.get('/audit-log', {
    schema: {
      tags: ['Admin'],
      summary: 'Admin audit log',
      description:
        'View recent admin/system governance actions with optional filters by action type or actor DID. ' +
        'Unlike the transparency audit log, this returns unredacted actor DIDs.',
      security: adminSecurity,
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
                  action: { type: 'string' },
                  actor: { type: 'string', nullable: true },
                  epochId: { type: 'integer', nullable: true },
                  details: { type: 'object' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
            total: { type: 'integer' },
          },
          required: ['entries', 'total'],
        },
        400: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = AuditLogQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.issues,
      });
    }

    const { limit, action, actor } = parseResult.data;

    // Build dynamic query
    let sql = `
      SELECT id, action, actor_did, epoch_id, details, created_at
      FROM governance_audit_log
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (action) {
      sql += ` AND action = $${paramIndex++}`;
      params.push(action);
    }

    if (actor) {
      sql += ` AND actor_did = $${paramIndex++}`;
      params.push(actor);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query(sql, params);

    // Get total count with same filters
    let countSql = 'SELECT COUNT(*) as total FROM governance_audit_log WHERE 1=1';
    const countParams: string[] = [];
    let countIndex = 1;

    if (action) {
      countSql += ` AND action = $${countIndex++}`;
      countParams.push(action);
    }
    if (actor) {
      countSql += ` AND actor_did = $${countIndex++}`;
      countParams.push(actor);
    }

    const countResult = await db.query(countSql, countParams);

    return reply.send({
      entries: result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor: row.actor_did,
        epochId: row.epoch_id,
        details: row.details,
        timestamp: row.created_at,
      })),
      total: parseInt(countResult.rows[0].total, 10),
    });
  });
}
