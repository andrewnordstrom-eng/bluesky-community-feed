/**
 * Admin Announcement Routes
 *
 * GET /api/admin/announcements - List recent announcements
 * POST /api/admin/announcements - Post a custom announcement
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { getAdminDid } from '../../auth/admin.js';
import { postAnnouncement } from '../../bot/poster.js';
import { logger } from '../../lib/logger.js';
import { adminSecurity } from '../../lib/openapi.js';

const PostAnnouncementSchema = z.object({
  content: z.string().min(1).max(280),
  includeEpochLink: z.boolean().optional().default(true),
});

/**
 * Convert AT URI to Bluesky web URL
 */
function uriToUrl(uri: string): string {
  const match = uri.match(/at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(.+)/);
  if (match) {
    return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
  }
  return uri;
}

export function registerAnnouncementRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/announcements
   * List recent announcements
   */
  app.get('/announcements', { schema: { tags: ['Admin'], security: adminSecurity } }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query(`
      SELECT
        id,
        epoch_id,
        content,
        uri,
        type,
        created_at
      FROM bot_announcements
      WHERE deleted = FALSE
      ORDER BY created_at DESC
      LIMIT 20
    `);

    return reply.send({
      announcements: result.rows.map((row) => ({
        id: row.id,
        epochId: row.epoch_id,
        content: row.content,
        postUri: row.uri,
        postUrl: uriToUrl(row.uri),
        type: row.type,
        postedAt: row.created_at,
      })),
    });
  });

  /**
   * POST /api/admin/announcements
   * Post a custom announcement
   */
  app.post('/announcements', { schema: { tags: ['Admin'], security: adminSecurity } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    // Validate request body
    const parseResult = PostAnnouncementSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parseResult.error.issues,
      });
    }

    const body = parseResult.data;

    // Rate limit: check last announcement time from this admin
    const recent = await db.query(
      `SELECT created_at FROM bot_announcements
       WHERE type = 'manual'
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (recent.rows.length > 0) {
      const lastPosted = new Date(recent.rows[0].created_at);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (lastPosted > fiveMinutesAgo) {
        const waitSeconds = Math.ceil((lastPosted.getTime() - fiveMinutesAgo.getTime()) / 1000);
        return reply.status(429).send({
          error: `Rate limited. Please wait ${waitSeconds} seconds before posting another announcement.`,
        });
      }
    }

    try {
      // Post using existing bot infrastructure
      const result = await postAnnouncement({
        type: 'manual',
        message: body.content,
      });

      if (!result) {
        return reply.status(503).send({
          error: 'Bot is disabled. Cannot post announcements.',
        });
      }

      // Log to audit
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, details)
         VALUES ('announcement_posted', $1, $2)`,
        [
          adminDid,
          JSON.stringify({
            content: body.content,
            postUri: result.uri,
            announcementId: result.id,
          }),
        ]
      );

      logger.info({ postUri: result.uri, adminDid }, 'Custom announcement posted via admin API');

      return reply.send({
        success: true,
        announcement: {
          id: result.id,
          postUri: result.uri,
          postUrl: uriToUrl(result.uri),
          content: result.content,
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to post announcement');
      return reply.status(500).send({ error: 'Failed to post announcement to Bluesky' });
    }
  });
}
