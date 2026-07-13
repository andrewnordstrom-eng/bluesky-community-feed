/**
 * Waitlist Route
 *
 * POST /api/governance/waitlist - Request voting access during the pilot.
 *
 * Public (unauthenticated) intake: stores a normalized Bluesky handle plus an
 * optional note. The response is deliberately identical for new, duplicate,
 * already-approved, and rejected handles so the endpoint cannot be used to
 * probe anyone's approval status. Decisions happen in the admin waitlist
 * routes and are audit-logged there; intake itself is not audit-logged
 * because it is unauthenticated and rate-limited rather than trusted.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { zodToOpenApi, ErrorResponseSchema, RateLimitResponseSchema } from '../../lib/openapi.js';

/**
 * Bluesky handles are domains (user.bsky.social, or a custom domain like
 * example.com). This intentionally rejects DIDs — admins can add DIDs
 * directly through the participants API.
 */
const HANDLE_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

const WaitlistSchema = z.object({
  handle: z
    .string()
    .trim()
    .min(1, 'Handle is required')
    .max(253)
    .transform((value) => value.replace(/^@/, '').toLowerCase())
    .refine((value) => HANDLE_RE.test(value), {
      message: 'Enter a Bluesky handle like you.bsky.social',
    }),
  note: z.string().trim().max(500).optional(),
});

const GENERIC_SUCCESS = {
  success: true,
  message: "You're on the list. We approve pilot accounts in batches — the demo and transparency pages stay open to everyone in the meantime.",
} as const;

export function registerWaitlistRoute(app: FastifyInstance): void {
  app.post('/api/governance/waitlist', {
    schema: {
      tags: ['Governance'],
      summary: 'Join the voting waitlist',
      description:
        'Request voting access during the pilot by submitting a Bluesky handle and optional note. ' +
        'The response does not reveal whether the handle was already on the list or approved.',
      body: zodToOpenApi(WaitlistSchema),
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
          },
          required: ['success', 'message'],
        },
        400: ErrorResponseSchema,
        429: RateLimitResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = WaitlistSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { handle, note } = parseResult.data;

    try {
      // Dedupe no-op for every existing state (pending, approved, rejected):
      // rejections stay sticky and the first note wins, so a stranger cannot
      // overwrite the note attached to someone else's handle.
      const result = await db.query(
        `INSERT INTO waitlist_requests (handle, note)
         VALUES ($1, $2)
         ON CONFLICT (handle) DO NOTHING`,
        [handle, note ?? null]
      );

      if ((result.rowCount ?? 0) > 0) {
        logger.info({ handle }, 'Waitlist request recorded');
      }

      return reply.send(GENERIC_SUCCESS);
    } catch (err) {
      logger.error({ err, handle }, 'Failed to record waitlist request');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'Could not record your request. Please try again.',
      });
    }
  });
}
