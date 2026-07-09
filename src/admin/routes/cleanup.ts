/**
 * Admin Cleanup Routes
 *
 * POST /api/admin/trigger-cleanup - Manually trigger the retention cleanup job
 *
 * PROJ-917: ops/health-watchdog used to curl this exact path expecting it
 * to already exist; it never did (a 404 silently swallowed by `|| true`).
 * This route makes it real for authenticated interactive use (an admin
 * dashboard "run cleanup now" button, manual incident response over curl
 * with a real session token).
 *
 * It deliberately does NOT make ops/health-watchdog's automated curl call
 * work: every /api/admin/* route requires the same session-cookie/Bearer
 * admin auth as the rest of the dashboard (src/auth/admin.ts's
 * requireAdmin, which resolves a DID via a Bluesky-login-backed Redis
 * session), and a systemd timer script has no way to hold or refresh one.
 * Pointing the watchdog's curl at this route would just trade a silent 404
 * for a silent 401 — see ops/health-watchdog's header comment, which was
 * updated in the same change to remove that call rather than pretend it
 * could ever authenticate.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { getAdminDid } from '../../auth/admin.js';
import { triggerManualCleanup } from '../../maintenance/cleanup.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';
import { logger } from '../../lib/logger.js';

const cleanupResultSchema = {
  type: 'object' as const,
  nullable: true,
  properties: {
    postsDeleted: { type: 'integer' as const },
    orphanedLikesDeleted: { type: 'integer' as const },
    orphanedRepostsDeleted: { type: 'integer' as const },
    orphanedEngagementDeleted: { type: 'integer' as const },
    staleLikesDeleted: { type: 'integer' as const },
    staleRepostsDeleted: { type: 'integer' as const },
    oldFollowsDeleted: { type: 'integer' as const },
    vacuumRan: { type: 'boolean' as const },
    durationMs: { type: 'integer' as const },
  },
};

export function registerCleanupRoutes(app: FastifyInstance): void {
  /**
   * POST /api/admin/trigger-cleanup
   * Manually triggers the hourly retention cleanup job
   * (src/maintenance/cleanup.ts's triggerManualCleanup). Logged to audit
   * trail. Returns a null result (with success: false) if a cleanup run
   * was already in progress or the scheduler is shutting down — that is
   * triggerManualCleanup()'s normal "rejected, try again shortly" signal,
   * not a route error.
   */
  app.post('/trigger-cleanup', {
    schema: {
      tags: ['Admin'],
      summary: 'Trigger retention cleanup',
      description:
        'Manually triggers the retention cleanup job: hard-deletes unscored posts past retention, orphaned likes/reposts/post_engagement, stale likes/reposts, and old follows. Requires admin access.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean', description: 'False if a cleanup run was already in progress' },
            result: cleanupResultSchema,
          },
          required: ['success', 'result'],
        },
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    logger.info({ adminDid }, 'Manual cleanup triggered by admin');

    const result = await triggerManualCleanup();

    // Audit-log write is best-effort: triggerManualCleanup() already ran and
    // may have mutated a lot of state, so a failure here must not turn into
    // a 500 that discards `result` from the caller — mirrors how
    // src/maintenance/cleanup.ts treats its own system_status write as
    // non-fatal (catch + warn) for exactly this reason.
    try {
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, details)
         VALUES ('manual_cleanup_trigger', $1, $2)`,
        [adminDid, JSON.stringify({ triggeredAt: new Date().toISOString(), result })]
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to write manual_cleanup_trigger audit log entry');
    }

    return reply.send({
      success: result !== null,
      result,
    });
  });
}
