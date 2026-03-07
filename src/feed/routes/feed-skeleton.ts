/**
 * Feed Skeleton Route
 *
 * This is the core feed endpoint that Bluesky calls to get post URIs.
 * CRITICAL: Response time target is <50ms. Only read from Redis/PostgreSQL.
 * NEVER call external APIs from this endpoint.
 *
 * Phase 3: Reads from Redis sorted set with real ranked posts.
 * Uses snapshot-based cursors for stable pagination.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ErrorResponseSchema } from '../../lib/openapi.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../db/redis.js';
import { upsertSubscriberAsync } from '../../db/queries/subscribers.js';
import { encodeCursor, decodeCursor } from '../cursor.js';
import { verifyFeedRequesterDid } from '../jwt-verifier.js';
import { isParticipantApproved } from '../access-control.js';

// The AT-URI for this feed
const FEED_URI = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;
const MIN_CURSOR_OFFSET = 0;
const MAX_CURSOR_OFFSET = 10000;

interface FeedRequestTrackingContext {
  authHeader: string | undefined;
  snapshotId: string;
  pageOffset: number;
  postsServed: number;
  postUris: string[];
  responseTimeMs: number;
}

async function trackFeedRequest(context: FeedRequestTrackingContext): Promise<void> {
  const viewerDid = await verifyFeedRequesterDid(context.authHeader);
  if (viewerDid) {
    upsertSubscriberAsync(viewerDid);
  }

  try {
    const epochIdStr = await redis.get('feed:epoch');
    const logEntry = JSON.stringify({
      viewer_did: viewerDid,
      epoch_id: epochIdStr ? parseInt(epochIdStr, 10) : 0,
      snapshot_id: context.snapshotId,
      page_offset: context.pageOffset,
      posts_served: context.postsServed,
      post_uris: context.postUris,
      position_start: context.pageOffset,
      response_time_ms: context.responseTimeMs,
      requested_at: new Date().toISOString(),
    });

    const pipeline = redis.pipeline();
    pipeline.rpush('feed:request_log', logEntry);
    pipeline.ltrim('feed:request_log', -100000, -1);
    await pipeline.exec();
  } catch (err) {
    logger.warn({ err }, 'Failed to log feed request to Redis');
  }
}

// Snapshot TTL in seconds (5 minutes - matches scoring interval)
const SNAPSHOT_TTL = 300;

interface FeedSkeletonQuery {
  feed: string;
  cursor?: string;
  limit?: string;
}

/** Route-level schema for OpenAPI docs (no superRefine — Ajv can't compile Zod effects). */
const FeedSkeletonRouteSchema = z.object({
  feed: z.string(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** JSON Schema for Fastify route definition (consumed by @fastify/swagger for OpenAPI). */
const FeedSkeletonQueryJsonSchema = zodToJsonSchema(FeedSkeletonRouteSchema, {
  target: 'openApi3',
});

/** Full validation schema including cursor structure check (used by safeParse in handler). */
const FeedSkeletonQuerySchema = FeedSkeletonRouteSchema.superRefine((query, ctx) => {
  if (query.cursor && decodeCursor(query.cursor) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cursor'],
      message: 'Cursor must be a valid feed pagination cursor',
    });
  }
});

/**
 * Register the getFeedSkeleton endpoint.
 *
 * Spec: §9.1-9.3 - GET /xrpc/app.bsky.feed.getFeedSkeleton
 */
export function registerFeedSkeleton(app: FastifyInstance): void {
  app.get(
    '/xrpc/app.bsky.feed.getFeedSkeleton',
    {
      schema: {
        tags: ['Feed'],
        summary: 'Get feed skeleton',
        description:
          'Returns a list of post URIs for the community-governed feed. Called by the Bluesky app. ' +
          'Uses snapshot-based cursors for stable pagination (5-minute TTL).',
        querystring: FeedSkeletonQueryJsonSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              feed: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    post: { type: 'string', description: 'AT-URI of the post', example: 'at://did:plc:example/app.bsky.feed.post/abc123' },
                  },
                  required: ['post'],
                },
                description: 'Ordered list of post references',
              },
              cursor: { type: 'string', description: 'Pagination cursor for the next page (absent on last page)' },
            },
            required: ['feed'],
          },
          400: ErrorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FeedSkeletonQuery }>, reply) => {
      const startTime = performance.now();

      const parseResult = FeedSkeletonQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'ValidationError',
          message: 'Invalid query parameters',
          details: parseResult.error.issues,
        });
      }

      const { feed, cursor, limit } = parseResult.data;

      // Validate this is a request for OUR feed
      if (feed !== FEED_URI) {
        logger.warn({ feed, expected: FEED_URI }, 'Unknown feed requested');
        return reply.code(400).send({
          error: 'UnsupportedAlgorithm',
          message: 'Unknown feed',
        });
      }

      // Private feed mode: require approved participant
      if (config.FEED_PRIVATE_MODE) {
        const viewerDid = await verifyFeedRequesterDid(request.headers.authorization);
        if (!viewerDid) return reply.send({ feed: [] });
        const approved = await isParticipantApproved(viewerDid);
        if (!approved) return reply.send({ feed: [] });
      }

      let postUris: string[];
      let offset: number;
      let snapshotId: string;

      if (cursor) {
        // Subsequent page: read from existing snapshot
        const parsed = decodeCursor(cursor);
        if (!parsed) {
          logger.warn({ cursor }, 'Invalid cursor');
          return reply.code(400).send({
            error: 'ValidationError',
            message: 'Invalid query parameters',
            details: [
              {
                path: ['cursor'],
                message: 'Cursor must be a valid feed pagination cursor',
              },
            ],
          });
        }

        snapshotId = parsed.snapshotId;
        offset = parsed.offset;

        if (offset < MIN_CURSOR_OFFSET || offset > MAX_CURSOR_OFFSET) {
          logger.warn({ snapshotId, offset }, 'Cursor offset out of supported bounds');
          return reply.send({ feed: [] });
        }

        // Try to get snapshot from Redis
        const snapshotData = await redis.get(`snapshot:${snapshotId}`);
        if (!snapshotData) {
          // Snapshot expired, return empty to signal client to refresh
          logger.debug({ snapshotId }, 'Snapshot expired');
          return reply.send({ feed: [] });
        }

        const allUris: string[] = JSON.parse(snapshotData);
        postUris = allUris.slice(offset, offset + limit);
      } else {
        // First page: create new snapshot from current rankings
        snapshotId = randomUUID().substring(0, 8);
        offset = 0;

        // Get ranked posts from Redis sorted set (descending by score)
        const rankedUris = await redis.zrevrange('feed:current', 0, config.FEED_MAX_POSTS - 1);

        if (rankedUris.length === 0) {
          logger.debug('No posts in feed');
          return reply.send({ feed: [] });
        }

        // Cache snapshot for pagination stability
        await redis.setex(`snapshot:${snapshotId}`, SNAPSHOT_TTL, JSON.stringify(rankedUris));

        postUris = rankedUris.slice(0, limit);
      }

      // Check for pinned announcement (first page only)
      let pinnedUri: string | null = null;
      if (offset === 0) {
        const pinnedData = await redis.get('bot:latest_announcement');
        if (pinnedData) {
          try {
            const { uri } = JSON.parse(pinnedData);
            // Don't duplicate if already in feed
            if (uri && !postUris.includes(uri)) {
              pinnedUri = uri;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Build response with pinned post first
      const feedItems = pinnedUri
        ? [{ post: pinnedUri }, ...postUris.slice(0, limit - 1).map((uri) => ({ post: uri }))]
        : postUris.map((uri) => ({ post: uri }));

      const nextOffset = offset + postUris.length;
      const hasMore = postUris.length === limit;
      const responseTimeMs = Math.round(performance.now() - startTime);

      logger.debug(
        {
          feedItems: feedItems.length,
          hasMore,
          snapshotId,
          authHeaderPresent: Boolean(request.headers.authorization),
          responseTimeMs,
        },
        'Returning feed skeleton'
      );

      const response = {
        feed: feedItems,
        cursor: hasMore ? encodeCursor(snapshotId, nextOffset) : undefined,
      };

      // Keep getFeedSkeleton hot path non-blocking: verification + tracking happens async.
      setImmediate(() => {
        void trackFeedRequest({
          authHeader: request.headers.authorization,
          snapshotId,
          pageOffset: offset,
          postsServed: feedItems.length,
          postUris,
          responseTimeMs,
        });
      });

      return reply.send(response);
    }
  );
}
