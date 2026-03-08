/**
 * Announce Route
 *
 * Admin API endpoints for managing announcements.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';
import { getAuthenticatedDid, SessionStoreUnavailableError } from '../../governance/auth.js';
import { isBotEnabled, getBotDid } from '../agent.js';
import { postAnnouncement, getPinnedAnnouncement, unpinAnnouncement, getRecentAnnouncements } from '../poster.js';
import { getRetryQueueLength, clearRetryQueue, processRetryQueue } from '../safe-poster.js';

/**
 * Check if DID is an admin.
 */
function isAdmin(did: string): boolean {
  const adminDids = config.BOT_ADMIN_DIDS?.split(',').map((d) => d.trim()) ?? [];
  return adminDids.includes(did);
}

const ManualAnnouncementSchema = z.object({
  message: z.string().min(1).max(300),
});

/** JSON Schema for OpenAPI documentation. */
const ManualAnnouncementJsonSchema = zodToJsonSchema(ManualAnnouncementSchema, { target: 'jsonSchema7' });

/** Reusable announcement item schema fragment. */
const announcementItemSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'integer' as const },
    uri: { type: 'string' as const },
    type: { type: 'string' as const },
    epochId: { type: 'integer' as const, nullable: true },
    content: { type: 'string' as const },
    createdAt: { type: 'string' as const, format: 'date-time' },
  },
};

export function registerAnnounceRoute(app: FastifyInstance): void {
  /**
   * GET /api/bot/status
   * Get bot status and current pinned announcement.
   */
  app.get('/api/bot/status', {
    schema: {
      tags: ['Bot'],
      summary: 'Bot status',
      description: 'Returns bot status including enabled state, bot DID, current pinned announcement, and retry queue length.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            botDid: { type: 'string', nullable: true },
            pinned: { type: 'object', additionalProperties: true, nullable: true },
            retryQueueLength: { type: 'integer' },
          },
          required: ['enabled', 'retryQueueLength'],
        },
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }

    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      logger.warn({ did: requesterDid }, 'Non-admin attempted to access bot status');
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    const pinned = await getPinnedAnnouncement();
    const retryQueueLength = await getRetryQueueLength();

    return reply.send({
      enabled: isBotEnabled(),
      botDid: getBotDid(),
      pinned,
      retryQueueLength,
    });
  });

  /**
   * POST /api/bot/announce
   * Post a manual announcement. Requires admin DID.
   */
  app.post('/api/bot/announce', {
    schema: {
      tags: ['Bot'],
      summary: 'Post manual announcement',
      description: 'Posts a manual announcement as the bot account on Bluesky. Requires admin DID.',
      security: adminSecurity,
      body: ManualAnnouncementJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            announcement: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'integer' },
                uri: { type: 'string' },
                type: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          required: ['success'],
        },
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        500: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Authenticate
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Check admin
    if (!isAdmin(requesterDid)) {
      logger.warn({ did: requesterDid }, 'Non-admin attempted to post announcement');
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    // Validate body
    const parseResult = ManualAnnouncementSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    // Check bot enabled
    if (!isBotEnabled()) {
      return reply.code(503).send({
        error: 'ServiceUnavailable',
        message: 'Bot is not enabled. Set BOT_ENABLED=true with credentials.',
      });
    }

    try {
      const announcement = await postAnnouncement({
        type: 'manual',
        message: parseResult.data.message,
      });

      logger.info({ adminDid: requesterDid, announcementId: announcement?.id }, 'Manual announcement posted');

      return reply.send({
        success: true,
        announcement: announcement
          ? {
              id: announcement.id,
              uri: announcement.uri,
              type: announcement.type,
              createdAt: announcement.createdAt,
            }
          : null,
      });
    } catch (err) {
      logger.error({ err, adminDid: requesterDid }, 'Failed to post manual announcement');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'Failed to post announcement',
      });
    }
  });

  /**
   * DELETE /api/bot/unpin
   * Unpin the current announcement. Requires admin DID.
   */
  app.delete('/api/bot/unpin', {
    schema: {
      tags: ['Bot'],
      summary: 'Unpin announcement',
      description: 'Unpins the current pinned announcement. Requires admin DID.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            unpinned: { type: 'boolean' },
          },
          required: ['success', 'unpinned'],
        },
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    const unpinned = await unpinAnnouncement();

    logger.info({ adminDid: requesterDid, unpinned }, 'Unpin announcement requested');

    return reply.send({
      success: true,
      unpinned,
    });
  });

  /**
   * GET /api/bot/announcements
   * Get recent announcements.
   */
  app.get('/api/bot/announcements', {
    schema: {
      tags: ['Bot'],
      summary: 'List recent announcements',
      description: 'Returns recent bot announcements with type, epoch context, and content.',
      security: adminSecurity,
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Max announcements to return' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            announcements: { type: 'array', items: announcementItemSchema },
          },
          required: ['announcements'],
        },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '10', 10) || 10, 50);
    const announcements = await getRecentAnnouncements(limit);

    return reply.send({
      announcements: announcements.map((a) => ({
        id: a.id,
        uri: a.uri,
        type: a.type,
        epochId: a.epochId,
        content: a.content,
        createdAt: a.createdAt,
      })),
    });
  });

  /**
   * POST /api/bot/retry
   * Process retry queue. Requires admin DID.
   */
  app.post('/api/bot/retry', {
    schema: {
      tags: ['Bot'],
      summary: 'Process retry queue',
      description: 'Processes the announcement retry queue, attempting to repost any failed announcements. Requires admin DID.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            processed: { type: 'integer', description: 'Number of retries processed' },
            remainingInQueue: { type: 'integer' },
          },
          required: ['success', 'processed', 'remainingInQueue'],
        },
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    const processed = await processRetryQueue();

    return reply.send({
      success: true,
      processed,
      remainingInQueue: await getRetryQueueLength(),
    });
  });

  /**
   * DELETE /api/bot/retry
   * Clear retry queue. Requires admin DID.
   */
  app.delete('/api/bot/retry', {
    schema: {
      tags: ['Bot'],
      summary: 'Clear retry queue',
      description: 'Clears the announcement retry queue, discarding all pending retries. Requires admin DID.',
      security: adminSecurity,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cleared: { type: 'integer', description: 'Number of entries cleared' },
          },
          required: ['success', 'cleared'],
        },
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    const cleared = await clearRetryQueue();

    logger.info({ adminDid: requesterDid, cleared }, 'Retry queue cleared');

    return reply.send({
      success: true,
      cleared,
    });
  });
}
