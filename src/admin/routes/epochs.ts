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
import { config } from '../../config.js';
import { forceEpochTransition, triggerEpochTransition } from '../../governance/epoch-manager.js';
import { readEpochWeightsForMultipleEpochs } from '../../governance/weight-longtable.js';
import { logger } from '../../lib/logger.js';

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
  app.get('/epochs', async (_request: FastifyRequest, reply: FastifyReply) => {
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
  app.patch('/epochs/current', async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/epochs/transition', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = TransitionSchema.safeParse(request.body || {});

    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.issues });
    }

    const body = parseResult.data;

    // Get current epoch info before transition. The "weight votes" count
    // (votes that include a complete weight vector, as opposed to
    // content-only votes that only touch include/exclude keywords) is
    // computed differently for each storage backend:
    //   - Wide path: a vote is a "weight vote" iff all 5 named columns are
    //     non-null (legacy behavior).
    //   - Long path: a vote is a "weight vote" iff it has any rows in
    //     governance_vote_weights (the writer skips null/undefined values,
    //     so a vote with all-null weights is not represented).
    //
    // After PROJ-819 (P5) the wide columns are dropped and only the long
    // branch remains.
    const weightVoteCountSql = config.GOVERNANCE_LONGTABLE_READ_ENABLED
      ? `(SELECT COUNT(*)::int
          FROM governance_votes v
          WHERE v.epoch_id = governance_epochs.id
            AND EXISTS (
              SELECT 1 FROM governance_vote_weights vw WHERE vw.vote_id = v.id
            ))`
      : `(SELECT COUNT(*)::int
          FROM governance_votes
          WHERE epoch_id = governance_epochs.id
            AND recency_weight IS NOT NULL
            AND engagement_weight IS NOT NULL
            AND bridging_weight IS NOT NULL
            AND source_diversity_weight IS NOT NULL
            AND relevance_weight IS NOT NULL)`;

    const current = await db.query(`
      SELECT id,
        (SELECT COUNT(*)::int FROM governance_votes WHERE epoch_id = governance_epochs.id) as vote_count,
        ${weightVoteCountSql} as weight_vote_count
      FROM governance_epochs
      WHERE status IN ('active', 'voting')
      ORDER BY id DESC
      LIMIT 1
    `);

    if (current.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }

    const previousEpochId = current.rows[0].id;
    const voteCount = parseInt(current.rows[0].vote_count, 10);
    const weightVoteCount = parseInt(current.rows[0].weight_vote_count, 10);

    // Check minimum votes unless forcing
    const minVotes = config.GOVERNANCE_MIN_VOTES;
    if (!body.force && weightVoteCount < minVotes) {
      return reply.status(400).send({
        error: `Insufficient weight votes for transition. Need ${minVotes}, have ${weightVoteCount}. Use force=true to override.`,
      });
    }

    try {
      // Use normal transition unless explicitly forced.
      let newEpochId: number;
      if (body.force) {
        newEpochId = await forceEpochTransition();
      } else {
        const transitionResult = await triggerEpochTransition();
        if (!transitionResult.success || !transitionResult.newEpochId) {
          return reply.status(400).send({
            error: transitionResult.error ?? 'Epoch transition failed',
          });
        }
        newEpochId = transitionResult.newEpochId;
      }

      // Log to audit
      await db.query(
        `INSERT INTO governance_audit_log (action, epoch_id, actor_did, details)
         VALUES ('epoch_transition', $1, $2, $3)`,
        [
          newEpochId,
          adminDid,
          JSON.stringify({
            fromEpoch: previousEpochId,
            forced: body.force,
            voteCount,
            weightVoteCount,
          }),
        ]
      );

      logger.info(
        { fromEpoch: previousEpochId, toEpoch: newEpochId, forced: body.force, adminDid },
        'Epoch transition triggered by admin'
      );

      // Get new epoch data
      const newEpoch = await db.query(`SELECT * FROM governance_epochs WHERE id = $1`, [newEpochId]);

      return reply.send({
        success: true,
        previousEpochId,
        newEpoch: {
          id: newEpochId,
          status: newEpoch.rows[0].status,
        },
        voteCount,
        weightVoteCount,
      });
    } catch (err) {
      logger.error({ err }, 'Epoch transition failed');
      return reply.status(500).send({ error: 'Epoch transition failed' });
    }
  });

  // Note: close-voting and open-voting endpoints removed
  // The schema uses status='active'/'closed' instead of a separate voting_open column
}
