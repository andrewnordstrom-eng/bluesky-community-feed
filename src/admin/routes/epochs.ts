/**
 * Admin Epoch Routes
 *
 * Epoch management endpoints for admin dashboard:
 * - GET /epochs - List all epochs
 * - PATCH /epochs/current - Update current epoch settings
 * - POST /epochs/transition - Trigger epoch transition
 * - POST /epochs/close-voting - Close voting
 * - POST /epochs/open-voting - Open voting
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { getAdminDid } from '../../auth/admin.js';
import { readEpochWeightsForMultipleEpochs } from '../../governance/weight-longtable.js';
import { logger } from '../../lib/logger.js';
import { adminSecurity } from '../../lib/openapi.js';

const UpdateEpochSchema = z.object({
  votingEndsAt: z.string().datetime().nullable().optional(),
  autoTransition: z.boolean().optional(),
});

const TransitionSchema = z.object({
  force: z.boolean().optional().default(false),
});

export function registerEpochRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/epochs
   * List all epochs with details
   */
  app.get('/epochs', {
    schema: {
      tags: ['Admin'],
      summary: 'List epochs',
      description: 'Lists recent governance epochs with their weights, vote counts, and status.',
      security: adminSecurity,
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // List N epochs without their weight columns; per-component weights come
    // from the storage-agnostic batch reader so this route works the same
    // under both wide-column and long-table storage.
    const result = await db.query(`
      SELECT
        e.id,
        e.status,
        e.voting_ends_at,
        e.auto_transition,
        e.content_rules,
        e.created_at,
        e.closed_at,
        COUNT(v.id) as vote_count
      FROM governance_epochs e
      LEFT JOIN governance_votes v ON v.epoch_id = e.id
      GROUP BY e.id
      ORDER BY e.id DESC
      LIMIT 20
    `);

    const epochIds = result.rows.map((row) => row.id as number);
    const weightsByEpoch = await readEpochWeightsForMultipleEpochs({ epochIds });

    return reply.send({
      epochs: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        votingEndsAt: row.voting_ends_at,
        autoTransition: row.auto_transition,
        weights: weightsByEpoch[row.id] ?? {},
        contentRules: row.content_rules,
        voteCount: parseInt(row.vote_count, 10),
        createdAt: row.created_at,
        closedAt: row.closed_at,
      })),
    });
  });

  /**
   * PATCH /api/admin/epochs/current
   * Update current epoch settings
   */
  app.patch('/epochs/current', {
    schema: {
      tags: ['Admin'],
      summary: 'Update current epoch',
      description: 'Updates the active epoch voting window or auto-transition settings.',
      security: adminSecurity,
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = UpdateEpochSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.issues });
    }

    const body = parseResult.data;

    // Get current epoch
    const current = await db.query(`
      SELECT id
      FROM governance_epochs
      WHERE status IN ('active', 'voting')
      ORDER BY id DESC
      LIMIT 1
    `);

    if (current.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }

    const epochId = current.rows[0].id;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (body.votingEndsAt !== undefined) {
      // Validate future date if setting
      if (body.votingEndsAt && new Date(body.votingEndsAt) <= new Date()) {
        return reply.status(400).send({ error: 'Voting end date must be in the future' });
      }
      updates.push(`voting_ends_at = $${paramIndex++}`);
      values.push(body.votingEndsAt);
    }

    if (body.autoTransition !== undefined) {
      updates.push(`auto_transition = $${paramIndex++}`);
      values.push(body.autoTransition);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No updates provided' });
    }

    values.push(epochId);

    const result = await db.query(
      `UPDATE governance_epochs
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    // Log to audit
    await db.query(
      `INSERT INTO governance_audit_log (action, epoch_id, actor_did, details)
       VALUES ('epoch_updated', $1, $2, $3)`,
      [epochId, adminDid, JSON.stringify({ updates: body })]
    );

    logger.info({ epochId, updates: body, adminDid }, 'Epoch updated by admin');

    return reply.send({
      success: true,
      epoch: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        votingEndsAt: result.rows[0].voting_ends_at,
        autoTransition: result.rows[0].auto_transition,
      },
    });
  });

  /**
   * POST /api/admin/epochs/transition
   * Manually trigger epoch transition
   */
  app.post('/epochs/transition', {
    schema: {
      tags: ['Admin'],
      summary: 'Direct transition disabled',
      description: 'Direct epoch transitions are disabled. Use the voting lifecycle: start voting, close voting, review results, then approve the complete policy.',
      security: adminSecurity,
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    getAdminDid(request);
    const parseResult = TransitionSchema.safeParse(request.body || {});

    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.issues });
    }

    return reply.status(409).send({
      error: 'DirectTransitionDisabled',
      message: 'Direct epoch transitions are disabled. Start voting, close voting, review the proposed policy, and approve results.',
    });
  });

  // Note: close-voting and open-voting endpoints removed
  // The schema uses status='active'/'closed' instead of a separate voting_open column
}
