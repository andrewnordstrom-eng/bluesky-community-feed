/**
 * Admin Waitlist Management Routes
 *
 * Review queue for the voting-pilot waitlist. Approval resolves the stored
 * handle to a DID and upserts it into approved_participants (the login and
 * voting allowlist); rejection just marks the row. Both decisions are
 * audit-logged. Registered under /api/admin with requireAdmin inherited
 * from the admin route index.
 *
 * GET  /api/admin/waitlist?status=pending|approved|rejected|all
 * POST /api/admin/waitlist/:id/approve
 * POST /api/admin/waitlist/:id/reject
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { invalidateParticipantCache } from '../../feed/access-control.js';
import { getAdminDid } from '../../auth/admin.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';
import { resolveHandleToDid } from './resolve-handle.js';

const ListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
});

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const WAITLIST_ROW_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    handle: { type: 'string' },
    did: { type: 'string', nullable: true },
    note: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    created_at: { type: 'string', format: 'date-time' },
    decided_at: { type: 'string', format: 'date-time', nullable: true },
    decided_by: { type: 'string', nullable: true },
  },
} as const;

export function registerWaitlistRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/waitlist
   * List waitlist requests, oldest first (it is a queue).
   */
  app.get('/waitlist', {
    schema: {
      tags: ['Admin'],
      summary: 'List waitlist requests',
      description: 'Returns voting-pilot waitlist requests filtered by status (default pending), oldest first.',
      security: adminSecurity,
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'all'], default: 'pending' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            requests: { type: 'array', items: WAITLIST_ROW_SCHEMA },
            total: { type: 'integer' },
          },
          required: ['requests', 'total'],
        },
        400: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid status filter', parsed.error.issues);
    }
    const { status } = parsed.data;

    const result = status === 'all'
      ? await db.query(
          `SELECT id, handle, did, note, status, created_at, decided_at, decided_by
           FROM waitlist_requests ORDER BY created_at ASC`
        )
      : await db.query(
          `SELECT id, handle, did, note, status, created_at, decided_at, decided_by
           FROM waitlist_requests WHERE status = $1 ORDER BY created_at ASC`,
          [status]
        );

    return reply.send({ requests: result.rows, total: result.rows.length });
  });

  /**
   * POST /api/admin/waitlist/:id/approve
   * Resolve the handle to a DID, add to approved_participants, mark approved.
   */
  app.post('/waitlist/:id/approve', {
    schema: {
      tags: ['Admin'],
      summary: 'Approve a waitlist request',
      description:
        'Resolves the stored handle to a DID, adds it to approved_participants (re-activating a previously ' +
        'removed row if needed), and marks the request approved. Fails with 400 if the handle cannot be ' +
        'resolved — the row stays pending and the account can be added by DID via the participants API.',
      security: adminSecurity,
      params: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            did: { type: 'string' },
            handle: { type: 'string' },
          },
          required: ['success', 'did', 'handle'],
        },
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid waitlist id', parsed.error.issues);
    }
    const { id } = parsed.data;
    const adminDid = getAdminDid(request);

    const existing = await db.query(
      `SELECT id, handle, status FROM waitlist_requests WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      throw Errors.NOT_FOUND('Waitlist request');
    }
    if (existing.rows[0].status !== 'pending') {
      throw Errors.CONFLICT('Request already decided');
    }

    const { handle } = existing.rows[0];

    let did: string;
    try {
      const resolved = await resolveHandleToDid(handle);
      did = resolved.did;
    } catch (err) {
      logger.warn({ handle, err }, 'Waitlist approve: failed to resolve handle');
      throw Errors.BAD_REQUEST(
        `Could not resolve handle: ${handle}. The row stays pending — add the account by DID via the participants API if needed.`
      );
    }

    // Same upsert as the participants route: re-activates a soft-removed row.
    await db.query(
      `INSERT INTO approved_participants (did, handle, added_by, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (did) DO UPDATE SET
         removed_at = NULL,
         handle = COALESCE($2, approved_participants.handle),
         added_by = $3,
         notes = $4,
         added_at = NOW()`,
      [did, handle, adminDid, `waitlist #${id}`]
    );

    await db.query(
      `UPDATE waitlist_requests
       SET status = 'approved', did = $2, decided_at = NOW(), decided_by = $3
       WHERE id = $1`,
      [id, did, adminDid]
    );

    // Without this, a login attempt made before approval leaves a cached
    // negative for up to 300s and the newly approved account stays locked out.
    await invalidateParticipantCache(did);

    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ($1, $2, $3)`,
      ['waitlist_approved', adminDid, JSON.stringify({ id, handle, did })]
    );

    logger.info({ id, handle, did, adminDid }, 'Waitlist request approved');

    return reply.send({ success: true, did, handle });
  });

  /**
   * POST /api/admin/waitlist/:id/reject
   * Mark a pending request rejected. Sticky against re-submission (intake
   * dedupes on handle), but an admin can still approve directly later.
   */
  app.post('/waitlist/:id/reject', {
    schema: {
      tags: ['Admin'],
      summary: 'Reject a waitlist request',
      description: 'Marks a pending waitlist request as rejected. The handle can still be approved later via the participants API.',
      security: adminSecurity,
      params: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
          required: ['success'],
        },
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = IdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      throw Errors.VALIDATION_ERROR('Invalid waitlist id', parsed.error.issues);
    }
    const { id } = parsed.data;
    const adminDid = getAdminDid(request);

    const result = await db.query(
      `UPDATE waitlist_requests
       SET status = 'rejected', decided_at = NOW(), decided_by = $2
       WHERE id = $1 AND status = 'pending'
       RETURNING handle`,
      [id, adminDid]
    );

    if (result.rows.length === 0) {
      const exists = await db.query(`SELECT status FROM waitlist_requests WHERE id = $1`, [id]);
      if (exists.rows.length === 0) {
        throw Errors.NOT_FOUND('Waitlist request');
      }
      throw Errors.CONFLICT('Request already decided');
    }

    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ($1, $2, $3)`,
      ['waitlist_rejected', adminDid, JSON.stringify({ id, handle: result.rows[0].handle })]
    );

    logger.info({ id, handle: result.rows[0].handle, adminDid }, 'Waitlist request rejected');

    return reply.send({ success: true });
  });
}
