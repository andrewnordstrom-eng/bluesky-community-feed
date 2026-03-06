/**
 * Admin Participant Management Routes
 *
 * CRUD endpoints for managing approved participants in private feed mode.
 * Participants can be added by DID or Bluesky handle (resolved via AT Protocol).
 *
 * GET  /api/admin/participants      - List active participants
 * POST /api/admin/participants      - Add a participant (DID or handle)
 * DELETE /api/admin/participants/:did - Soft-remove a participant
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AtpAgent } from '@atproto/api';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { invalidateParticipantCache } from '../../feed/access-control.js';
import { getAuthenticatedDid } from '../../governance/auth.js';

const AddParticipantSchema = z
  .object({
    did: z.string().startsWith('did:').optional(),
    handle: z.string().min(1).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((data) => data.did || data.handle, {
    message: 'Must provide did or handle',
  });

/**
 * Resolve a Bluesky handle to a DID.
 */
async function resolveHandleToDid(handle: string): Promise<{ did: string; handle: string }> {
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  const response = await agent.resolveHandle({ handle });
  return { did: response.data.did, handle };
}

export function registerParticipantRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/participants
   * List all active (non-removed) participants.
   */
  app.get('/participants', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query(
      `SELECT did, handle, added_by, notes, added_at
       FROM approved_participants
       WHERE removed_at IS NULL
       ORDER BY added_at DESC`
    );

    return reply.send({
      participants: result.rows,
      total: result.rows.length,
    });
  });

  /**
   * POST /api/admin/participants
   * Add a new approved participant. Accepts DID or Bluesky handle.
   */
  app.post('/participants', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = AddParticipantSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw Errors.VALIDATION_ERROR('Must provide did or handle', parseResult.error.issues);
    }

    const { did: inputDid, handle: inputHandle, notes } = parseResult.data;
    let resolvedDid: string;
    let resolvedHandle: string | null = inputHandle ?? null;

    if (inputDid) {
      resolvedDid = inputDid;
    } else {
      // Resolve handle to DID
      try {
        const resolved = await resolveHandleToDid(inputHandle!);
        resolvedDid = resolved.did;
        resolvedHandle = resolved.handle;
      } catch (err) {
        logger.warn({ handle: inputHandle, err }, 'Failed to resolve handle');
        throw Errors.BAD_REQUEST(`Could not resolve handle: ${inputHandle}`);
      }
    }

    // Check if already approved (active)
    const existing = await db.query(
      `SELECT id FROM approved_participants WHERE did = $1 AND removed_at IS NULL`,
      [resolvedDid]
    );

    if (existing.rows.length > 0) {
      throw Errors.CONFLICT('Participant already approved');
    }

    // Get admin DID for added_by
    let adminDid = 'admin';
    try {
      const did = await getAuthenticatedDid(request);
      if (did) adminDid = did;
    } catch {
      // Fall back to 'admin' if session lookup fails
    }

    // Insert (or re-activate if previously removed)
    await db.query(
      `INSERT INTO approved_participants (did, handle, added_by, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (did) DO UPDATE SET
         removed_at = NULL,
         handle = COALESCE($2, approved_participants.handle),
         added_by = $3,
         notes = $4,
         added_at = NOW()`,
      [resolvedDid, resolvedHandle, adminDid, notes ?? null]
    );

    // Invalidate cache so next feed request picks up the change
    await invalidateParticipantCache(resolvedDid);

    // Audit log
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ($1, $2, $3)`,
      [
        'participant_added',
        adminDid,
        JSON.stringify({ did: resolvedDid, handle: resolvedHandle, notes }),
      ]
    );

    logger.info({ did: resolvedDid, handle: resolvedHandle, adminDid }, 'Participant added');

    return reply.code(201).send({
      success: true,
      participant: { did: resolvedDid, handle: resolvedHandle, notes },
    });
  });

  /**
   * DELETE /api/admin/participants/:did
   * Soft-remove a participant (sets removed_at).
   */
  app.delete(
    '/participants/:did',
    async (request: FastifyRequest<{ Params: { did: string } }>, reply: FastifyReply) => {
      const { did } = request.params;

      const result = await db.query(
        `UPDATE approved_participants
         SET removed_at = NOW()
         WHERE did = $1 AND removed_at IS NULL
         RETURNING id, handle`,
        [did]
      );

      if (result.rows.length === 0) {
        throw Errors.NOT_FOUND('Participant');
      }

      // Invalidate cache
      await invalidateParticipantCache(did);

      // Get admin DID for audit
      let adminDid = 'admin';
      try {
        const adminDidResult = await getAuthenticatedDid(request);
        if (adminDidResult) adminDid = adminDidResult;
      } catch {
        // Fall back to 'admin'
      }

      // Audit log
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, details)
         VALUES ($1, $2, $3)`,
        [
          'participant_removed',
          adminDid,
          JSON.stringify({ did, handle: result.rows[0].handle }),
        ]
      );

      logger.info({ did, adminDid }, 'Participant removed');

      return reply.send({ success: true });
    }
  );
}
