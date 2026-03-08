/**
 * Admin Scheduler Routes
 *
 * GET /api/admin/scheduler/status - Get scheduler status
 * POST /api/admin/scheduler/check - Manually trigger scheduler check
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { getAdminDid } from '../../auth/admin.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';
import { runSchedulerCheck, getSchedulerStatus } from '../../scheduler/epoch-scheduler.js';
import { logger } from '../../lib/logger.js';

export function registerSchedulerRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/scheduler/status
   * Get scheduler status and pending transitions
   */
  app.get('/scheduler/status', {
    schema: {
      tags: ['Admin'],
      summary: 'Scheduler status',
      description: 'Returns the epoch scheduler status and any pending auto-transitions.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            scheduler: {
              type: 'object',
              properties: {
                running: { type: 'boolean' },
                interval_ms: { type: 'integer' },
                last_check: { type: 'string', format: 'date-time', nullable: true },
              },
            },
            pendingTransitions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  epochId: { type: 'integer' },
                  votingEndsAt: { type: 'string', format: 'date-time' },
                  autoTransition: { type: 'boolean' },
                  readyForTransition: { type: 'boolean' },
                },
              },
            },
          },
          required: ['scheduler', 'pendingTransitions'],
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = getSchedulerStatus();

    // Get epochs that would be transitioned on next check
    const pendingResult = await db.query(`
      SELECT id, voting_ends_at, auto_transition
      FROM governance_epochs
      WHERE status = 'active'
        AND phase = 'voting'
        AND voting_ends_at IS NOT NULL
        AND auto_transition = true
    `);

    const pending = pendingResult.rows.map((row) => ({
      epochId: row.id,
      votingEndsAt: row.voting_ends_at,
      autoTransition: row.auto_transition,
      readyForTransition: new Date(row.voting_ends_at) <= new Date(),
    }));

    return reply.send({
      scheduler: status,
      pendingTransitions: pending,
    });
  });

  /**
   * POST /api/admin/scheduler/check
   * Manually trigger scheduler check
   */
  app.post('/scheduler/check', {
    schema: {
      tags: ['Admin'],
      summary: 'Trigger scheduler check',
      description: 'Manually triggers the epoch scheduler to check for pending auto-transitions. Logged to audit trail.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            transitioned: { type: 'boolean', description: 'Whether an epoch was transitioned' },
            errors: { type: 'array', items: { type: 'string' } },
          },
          required: ['success'],
        },
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    logger.info({ adminDid }, 'Manual scheduler check triggered by admin');

    // Log to audit
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ('manual_scheduler_check', $1, $2)`,
      [adminDid, JSON.stringify({ triggeredAt: new Date().toISOString() })]
    );

    const result = await runSchedulerCheck();

    return reply.send({
      success: result.checked,
      transitioned: result.transitioned,
      errors: result.errors,
    });
  });
}
