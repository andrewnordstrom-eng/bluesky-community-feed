/**
 * Send Interactions Route
 *
 * POST /xrpc/app.bsky.feed.sendInteractions
 *
 * Receives user interaction signals from Bluesky clients (requestMore,
 * requestLess, etc.) and stores them for analytics and scoring feedback.
 * Part of the AT Protocol feed generator contract.
 *
 * @see https://docs.bsky.app/docs/api/app-bsky-feed-send-interactions
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { ErrorResponseSchema, RateLimitResponseSchema } from '../../lib/openapi.js';
import { verifyFeedRequesterDid } from '../jwt-verifier.js';
import { config } from '../../config.js';
import { isParticipantApproved } from '../access-control.js';

const MAX_INTERACTIONS_PER_REQUEST = 100;
const MAX_URI_LENGTH = 512;
const MAX_FEED_CONTEXT_LENGTH = 512;
const INTERACTION_EVENT_PATTERN = /^app\.bsky\.feed\.defs#[a-zA-Z][a-zA-Z0-9]{1,63}$/;

const InteractionSchema = z.object({
  item: z
    .string()
    .trim()
    .min(1)
    .max(MAX_URI_LENGTH)
    .startsWith('at://'),
  event: z
    .string()
    .trim()
    .regex(
      INTERACTION_EVENT_PATTERN,
      'Interaction event must use app.bsky.feed.defs#<EventName> format'
    ),
  feedContext: z.string().trim().max(MAX_FEED_CONTEXT_LENGTH).optional(),
});

const SendInteractionsBodySchema = z.object({
  interactions: z
    .array(InteractionSchema)
    .min(1)
    .max(MAX_INTERACTIONS_PER_REQUEST),
});

/** JSON Schema for Fastify route definition (consumed by @fastify/swagger for OpenAPI). */
const SendInteractionsBodyJsonSchema = zodToJsonSchema(SendInteractionsBodySchema, {
  target: 'openApi3',
});

/**
 * Register the sendInteractions endpoint.
 *
 * Accepts interaction signals from Bluesky clients and stores them
 * in feed_interactions for analytics and future scoring integration.
 */
export function registerSendInteractions(app: FastifyInstance): void {
  app.post(
    '/xrpc/app.bsky.feed.sendInteractions',
    {
      schema: {
        tags: ['Feed'],
        summary: 'Send interaction signals',
        description:
          'Receives user interaction signals (requestMore, requestLess, etc.) from Bluesky clients. ' +
          'Requires a valid JWT in the Authorization header. Stored for analytics and scoring feedback.',
        body: SendInteractionsBodyJsonSchema,
        response: {
          200: { type: 'object', description: 'Empty object on success' },
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          429: RateLimitResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      // Auth is mandatory for sendInteractions
      const requesterDid = await verifyFeedRequesterDid(
        request.headers.authorization
      );
      if (!requesterDid) {
        throw Errors.UNAUTHORIZED('Valid JWT required');
      }

      // Private mode: only allow approved participants to submit interactions.
      if (config.FEED_PRIVATE_MODE) {
        const approved = await isParticipantApproved(requesterDid);
        if (!approved) {
          throw Errors.FORBIDDEN('Private feed mode: approved participants only.');
        }
      }

      // Validate body
      const parseResult = SendInteractionsBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        throw Errors.VALIDATION_ERROR(
          'Invalid interactions payload',
          parseResult.error.issues
        );
      }

      const { interactions } = parseResult.data;

      // Get current epoch from Redis (non-blocking, default to null)
      let epochId: number | null = null;
      try {
        const epochIdStr = await redis.get('feed:epoch');
        if (epochIdStr) {
          epochId = parseInt(epochIdStr, 10);
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to read epoch from Redis for interactions');
      }

      // Batch INSERT with parameterized multi-row VALUES
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (let i = 0; i < interactions.length; i++) {
        const interaction = interactions[i];
        const base = i * 5;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
        );
        values.push(
          requesterDid,
          interaction.item,
          interaction.event,
          interaction.feedContext ?? null,
          epochId
        );
      }

      try {
        await db.query(
          `INSERT INTO feed_interactions (requester_did, post_uri, interaction_type, feed_context, epoch_id)
           VALUES ${placeholders.join(', ')}
           ON CONFLICT DO NOTHING`,
          values
        );
      } catch (err) {
        logger.error({ err, requesterDid, count: interactions.length }, 'Failed to store feed interactions');
        throw Errors.DATABASE_ERROR('Failed to store interactions');
      }

      logger.info(
        { requesterDid, count: interactions.length, epochId },
        'Stored feed interactions'
      );

      return reply.send({});
    }
  );
}
